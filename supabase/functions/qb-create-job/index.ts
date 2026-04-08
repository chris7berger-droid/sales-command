import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const QB_CLIENT_ID = Deno.env.get("QB_CLIENT_ID")!;
const QB_CLIENT_SECRET = Deno.env.get("QB_CLIENT_SECRET")!;
const QB_ENVIRONMENT = Deno.env.get("QB_ENVIRONMENT") || "sandbox";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const QB_API_BASE = QB_ENVIRONMENT === "production"
  ? "https://quickbooks.api.intuit.com"
  : "https://sandbox-quickbooks.api.intuit.com";

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

// ── Helper: get fresh QB access token ──────────────────────────────────
async function getQBToken(sb: any) {
  const { data: conn } = await sb.from("qb_connection").select("*").limit(1).single();
  if (!conn) throw new Error("No QuickBooks connection found. Connect QB first.");

  // If token expires within 5 minutes, refresh it
  if (new Date(conn.token_expires_at) < new Date(Date.now() + 5 * 60 * 1000)) {
    console.log("qb-create-job: refreshing expired token");
    const basicAuth = btoa(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`);
    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: conn.refresh_token,
      }).toString(),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(`Token refresh failed: ${tokenData.error || "unknown"}`);

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
    await sb.from("qb_connection").update({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }).eq("id", conn.id);

    return { accessToken: tokenData.access_token, realmId: conn.realm_id };
  }

  return { accessToken: conn.access_token, realmId: conn.realm_id };
}

// ── Helper: QB API request ─────────────────────────────────────────────
async function qbApi(method: string, path: string, accessToken: string, realmId: string, body?: any) {
  const url = `${QB_API_BASE}/v3/company/${realmId}${path}`;
  const opts: any = {
    method,
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) {
    console.error("QB API error:", JSON.stringify(data));
    throw new Error(`QB API ${res.status}: ${JSON.stringify(data?.Fault?.Error?.[0]?.Detail || data)}`);
  }
  return data;
}

// ── Helper: find customer by DisplayName ───────────────────────────────
async function findCustomer(name: string, accessToken: string, realmId: string) {
  const escaped = name.replace(/'/g, "\\'");
  const data = await qbApi("GET", `/query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${escaped}'`)}`, accessToken, realmId);
  return data?.QueryResponse?.Customer?.[0] || null;
}

const ALLOWED_ORIGINS = ["https://salescommand.app", "https://www.salescommand.app", "https://www.scmybiz.com", "https://scmybiz.com"];

serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify caller is authenticated
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const { callLogId } = await req.json();
    if (!callLogId) {
      return new Response(JSON.stringify({ error: "callLogId is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400,
      });
    }

    // Fetch call log with customer
    const { data: job } = await sb.from("call_log").select("*").eq("id", callLogId).single();
    if (!job) throw new Error(`Call log ${callLogId} not found`);

    // Fetch customer record
    let customer = null;
    if (job.customer_id) {
      const { data: c } = await sb.from("customers").select("*").eq("id", job.customer_id).single();
      customer = c;
    }

    const { accessToken, realmId } = await getQBToken(sb);

    // ── 1. Find or create PARENT customer ──────────────────────────────
    const parentName = job.customer_name || customer?.name || "Unknown Customer";
    let parentQB = await findCustomer(parentName, accessToken, realmId);

    if (!parentQB) {
      console.log("qb-create-job: creating parent customer:", parentName);
      const parentBody: any = {
        DisplayName: parentName,
        CompanyName: parentName,
      };
      // Add contact info from customer record
      if (customer) {
        if (customer.email || customer.contact_email) {
          parentBody.PrimaryEmailAddr = { Address: customer.contact_email || customer.email };
        }
        if (customer.phone || customer.contact_phone) {
          parentBody.PrimaryPhone = { FreeFormNumber: customer.contact_phone || customer.phone };
        }
        if (customer.business_address) {
          parentBody.BillAddr = {
            Line1: customer.business_address,
            City: customer.business_city || "",
            CountrySubDivisionCode: customer.business_state || "",
            PostalCode: customer.business_zip || "",
          };
        }
      }
      const res = await qbApi("POST", "/customer", accessToken, realmId, parentBody);
      parentQB = res.Customer;
      console.log("qb-create-job: parent created, QB ID:", parentQB.Id);

      // Save QB ID to customers table
      if (customer && !customer.qb_customer_id) {
        await sb.from("customers").update({ qb_customer_id: parentQB.Id }).eq("id", customer.id);
      }
    } else {
      console.log("qb-create-job: parent found, QB ID:", parentQB.Id);
      if (customer && !customer.qb_customer_id) {
        await sb.from("customers").update({ qb_customer_id: parentQB.Id }).eq("id", customer.id);
      }
    }

    // ── 2. Build sub-customer (job) display name ───────────────────────
    const jobNum = job.display_job_number || job.job_number || "";
    const coPrefix = job.is_change_order ? `CO${job.co_number || ""} ` : "";
    const jobName = job.job_name || "";
    // Format: "10002 - Job Name" or "10002 CO1 - Job Name"
    // QB already shows parent customer name, so sub-customer only needs job info
    // If job name matches customer name, just use the job number
    const showJobName = jobName && jobName.toLowerCase() !== parentName.toLowerCase();
    const subName = showJobName
      ? `${jobNum} ${coPrefix}- ${jobName}`.trim()
      : `${jobNum} ${coPrefix}- ${parentName}`.trim();

    // Check if sub-customer already exists
    let subQB = await findCustomer(subName, accessToken, realmId);

    if (!subQB) {
      console.log("qb-create-job: creating sub-customer:", subName);
      const subBody: any = {
        DisplayName: subName,
        CompanyName: parentName,
        Job: true,
        ParentRef: { value: parentQB.Id },
      };

      // Jobsite address as billing/shipping
      if (job.jobsite_address) {
        const addr = {
          Line1: job.jobsite_address,
          City: job.jobsite_city || "",
          CountrySubDivisionCode: job.jobsite_state || "",
          PostalCode: job.jobsite_zip || "",
        };
        subBody.BillAddr = addr;
        subBody.ShipAddr = addr;
      } else if (customer?.business_address) {
        const addr = {
          Line1: customer.business_address,
          City: customer.business_city || "",
          CountrySubDivisionCode: customer.business_state || "",
          PostalCode: customer.business_zip || "",
        };
        subBody.BillAddr = addr;
        subBody.ShipAddr = addr;
      }

      // Contact info
      if (customer?.contact_email || customer?.email) {
        subBody.PrimaryEmailAddr = { Address: customer.contact_email || customer.email };
      }
      if (customer?.contact_phone || customer?.phone) {
        subBody.PrimaryPhone = { FreeFormNumber: customer.contact_phone || customer.phone };
      }

      const res = await qbApi("POST", "/customer", accessToken, realmId, subBody);
      subQB = res.Customer;
      console.log("qb-create-job: sub-customer created, QB ID:", subQB.Id);
    } else {
      console.log("qb-create-job: sub-customer found, QB ID:", subQB.Id);
    }

    // Save the QB sub-customer ID to call_log for later invoice linking
    await sb.from("call_log").update({ qb_customer_id: subQB.Id }).eq("id", callLogId);

    return new Response(JSON.stringify({
      success: true,
      parentId: parentQB.Id,
      parentName,
      jobId: subQB.Id,
      jobName: subName,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    console.error("qb-create-job error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
