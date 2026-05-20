import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateCaller, unauthorizedResponse } from "../_shared/tenantAuth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const ALLOWED_ORIGINS = ["https://salescommand.app", "https://www.salescommand.app", "https://www.scmybiz.com", "https://scmybiz.com"];

function escapeHtml(input: unknown): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const isAllowed = ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".vercel.app");
  const allowedOrigin = isAllowed ? origin : ALLOWED_ORIGINS[0];
  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const caller = await authenticateCaller(supabase, req, SUPABASE_SERVICE_ROLE_KEY);
    if (!caller.ok) return unauthorizedResponse(caller.status, corsHeaders);
    if (caller.isServiceRole) {
      return new Response(JSON.stringify({ error: "Service role not allowed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403,
      });
    }

    const { proposalId, recipientEmail, recipientName, isViewer } = await req.json();

    if (!proposalId || !recipientEmail) {
      return new Response(JSON.stringify({ error: "proposalId and recipientEmail are required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400,
      });
    }

    // Load proposal + call_log + customer + tenant config server-side
    const { data: proposal, error: propErr } = await supabase
      .from("proposals")
      .select("id, proposal_number, signing_token, intro, tenant_id, call_log_id, call_log(customer_name, job_name, display_job_number, sales_name, customer_id)")
      .eq("id", proposalId)
      .maybeSingle();

    if (propErr || !proposal) {
      return new Response(JSON.stringify({ error: "Proposal not found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404,
      });
    }

    // Tenant assertion
    if (proposal.tenant_id !== caller.tenantId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403,
      });
    }

    // Load tenant config
    const { data: config } = await supabase
      .from("tenant_config")
      .select("company_name, tagline, phone, proposal_validity_days, default_proposal_intro")
      .eq("id", caller.tenantId)
      .maybeSingle();

    // Load rep info from team_members
    const salesName = proposal.call_log?.sales_name || "";
    let repEmail = "";
    let repName = salesName;
    if (salesName) {
      const { data: rep } = await supabase
        .from("team_members")
        .select("email, name")
        .eq("name", salesName)
        .eq("tenant_id", caller.tenantId)
        .maybeSingle();
      if (rep) {
        repEmail = rep.email || "";
        repName = rep.name || salesName;
      }
    }

    // Validate recipient against customer_contacts for the proposal's customer
    const customerId = proposal.call_log?.customer_id;
    if (customerId) {
      const { data: contacts } = await supabase
        .from("customer_contacts")
        .select("email")
        .eq("customer_id", customerId);
      const { data: cust } = await supabase
        .from("customers")
        .select("email, contact_email, billing_email")
        .eq("id", customerId)
        .maybeSingle();
      const allowedEmails = new Set([
        ...(contacts || []).map((c: any) => c.email?.toLowerCase()).filter(Boolean),
        cust?.email?.toLowerCase(),
        cust?.contact_email?.toLowerCase(),
        cust?.billing_email?.toLowerCase(),
      ].filter(Boolean));
      if (!allowedEmails.has(recipientEmail.toLowerCase())) {
        return new Response(JSON.stringify({ error: "Recipient email not associated with this customer" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400,
        });
      }
    }

    // Build signing URL server-side from proposal's signing_token
    const signingUrl = `${SUPABASE_URL.replace('.supabase.co', '.vercel.app')}/sign/${proposal.signing_token}`;
    // Use the known prod URL pattern
    const baseUrl = "https://www.scmybiz.com";
    const serverSigningUrl = `${baseUrl}/sign/${proposal.signing_token}`;

    const companyName = config?.company_name || "Sales Command";
    const companyTagline = config?.tagline || "";
    const companyPhone = config?.phone || "";
    const customerName = escapeHtml(recipientName || proposal.call_log?.customer_name || "Customer");
    const jobName = escapeHtml(proposal.call_log?.job_name || proposal.call_log?.display_job_number || "");
    const proposalNumber = escapeHtml(proposal.proposal_number || proposal.id);
    const emailIntro = proposal.intro || config?.default_proposal_intro || "";

    if (!RESEND_API_KEY) {
      console.error("RESEND_API_KEY is not set");
      return new Response(JSON.stringify({ error: "Email service not configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
      });
    }

    console.log("send-proposal invoked", { proposalId, recipientEmail, repEmail, proposalNumber });

    // Sender address
    const VERIFIED_DOMAINS = ["hdspnv.com", "scmybiz.com", "schmybiz.com", "salescommand.app"];
    const senderName = escapeHtml(repName || companyName);
    const repDomain = repEmail ? repEmail.split("@")[1]?.toLowerCase() : "";
    const fromAddress = repEmail && VERIFIED_DOMAINS.includes(repDomain)
      ? `${repName || companyName} <${repEmail}>`
      : `${repName || companyName} <noreply@salescommand.app>`;

    // Email to recipient
    const introHtml = emailIntro
      ? emailIntro.split("\n").map((line: string) => line.trim().length ? `<p>${escapeHtml(line)}</p>` : "").join("")
      : "<p>Your proposal is ready for review. Click the button below to view and sign.</p>";

    const customerRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        reply_to: repEmail || undefined,
        to: recipientEmail,
        subject: `Proposal Ready for Review — ${escapeHtml(proposal.call_log?.job_name || "")}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1c1814;">
            <div style="border-bottom: 4px solid #30cfac; padding-bottom: 16px; margin-bottom: 24px;">
              <h2 style="margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: 0.02em;">${escapeHtml(companyName)}</h2>
              ${companyTagline ? `<p style="margin: 4px 0 0; color: #4a4238; font-size: 13px;">${escapeHtml(companyTagline)}</p>` : ""}
            </div>
            <p>Hi ${customerName},</p>
            ${introHtml}
            <div style="margin: 32px 0;">
              <a href="${serverSigningUrl}" style="background: #30cfac; color: #1c1814; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px;">Review & Sign Proposal →</a>
            </div>
            <p style="color: #887c6e; font-size: 12px;">Proposal #${proposalNumber} · This link is unique to you and expires in ${config?.proposal_validity_days || 90} days.</p>
            <p style="color: #887c6e; font-size: 12px;">Questions? Reply to this email${companyPhone ? ` or call ${escapeHtml(companyPhone)}` : ""}.</p>
          </div>
        `,
      }),
    });

    const customerResBody = await customerRes.text();
    console.log("Recipient email response:", customerRes.status, customerResBody);

    if (!customerRes.ok) {
      return new Response(JSON.stringify({ error: `Failed to send email: ${customerResBody}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
      });
    }

    // Notification to rep (non-blocking, signer sends only)
    if (repEmail && !isViewer) {
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromAddress,
            to: repEmail,
            subject: `Proposal Sent — ${escapeHtml(proposal.call_log?.job_name || "")}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1c1814;">
                <p>Hi ${senderName},</p>
                <p>Proposal #${proposalNumber} for <strong>${customerName}</strong> (${jobName}) has been sent for signature.</p>
                <p style="color: #887c6e; font-size: 12px;">You will receive another notification when the customer signs.</p>
              </div>
            `,
          }),
        });
      } catch (e) {
        console.error("Rep email failed (non-fatal):", e.message);
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
    });

  } catch (error) {
    console.error("send-proposal error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }
});
