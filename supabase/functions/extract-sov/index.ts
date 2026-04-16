import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.88.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const ALLOWED_ORIGINS = [
  "https://salescommand.app",
  "https://www.salescommand.app",
  "https://www.scmybiz.com",
  "https://scmybiz.com",
];

const SOV_SYSTEM_PROMPT = `You extract Schedule of Values (SOV) line items from construction contract or subcontract PDFs.

The SOV is the breakdown of pay items the customer uses to bill against on a G702/G703 (AIA-style) payment application. It may appear as:
  - An "Exhibit" or "Schedule of Values" attachment
  - An inline table in the contract body
  - A lump-sum line if the contract is not broken down
  - A pay application's G703 continuation sheet (use the base "SCHEDULED VALUE" column)

For each pay item in the document, return:
  line_code: The customer's identifier if given (e.g., "A.1", "1", "01"). Empty string if no code.
  description: The scope description for that line.
  scheduled_value: The dollar amount as a number (no currency symbol or commas).
  is_change_order: true if the line is a Change Order / CO, false otherwise.
  co_number: CO sequence number if it's a change order, otherwise null.

Also return the top-level contract_sum (total) and retainage_pct if specified (as a number 0-100; default to null if not found).

Only extract actual pay items. Do not include terms, conditions, or narrative text as line items. If the document is a pay application showing previous billing, extract the SOV structure (Item Code / Description / Scheduled Value), not the billed-to-date numbers.

If the document does not contain an SOV (e.g., it's just a T&C document), return an empty lines array.`;

const SOV_TOOL = {
  name: "submit_sov",
  description: "Submit the extracted Schedule of Values from the contract document.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      contract_sum: {
        type: ["number", "null"],
        description: "Total contract sum if stated in the document; null if not found.",
      },
      retainage_pct: {
        type: ["number", "null"],
        description: "Retainage percent as a number 0-100 (e.g. 5 for 5%). Null if not specified.",
      },
      lines: {
        type: "array",
        description: "The SOV line items. Empty array if the document contains no SOV.",
        items: {
          type: "object",
          properties: {
            line_code: { type: "string" },
            description: { type: "string" },
            scheduled_value: { type: "number" },
            is_change_order: { type: "boolean" },
            co_number: { type: ["integer", "null"] },
          },
          required: ["line_code", "description", "scheduled_value", "is_change_order", "co_number"],
          additionalProperties: false,
        },
      },
      notes: {
        type: "string",
        description: "Brief note on what was extracted or any caveats (e.g., 'single lump sum', 'extracted from G703 continuation sheet').",
      },
    },
    required: ["contract_sum", "retainage_pct", "lines", "notes"],
    additionalProperties: false,
  },
};

serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const isAllowed = ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".vercel.app");
  const allowedOrigin = isAllowed ? origin : ALLOWED_ORIGINS[0];
  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Auth
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }
    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const { pdf_url } = await req.json();
    if (!pdf_url) {
      return new Response(JSON.stringify({ error: "pdf_url is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // Authorization: confirm pdf_url is attached to a billing_schedule the
    // caller's tenant owns. Uses a user-JWT-scoped client so RLS handles the
    // tenant filter — prevents callers from spending Anthropic credits (or
    // exfiltrating doc text) against URLs they don't own.
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: scheds, error: schedErr } = await userClient
      .from("billing_schedule")
      .select("contract_pdf_url, contract_pdf_urls");
    if (schedErr) {
      return new Response(JSON.stringify({ error: "Authorization check failed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }
    const ownedUrls = new Set<string>();
    for (const s of (scheds ?? []) as { contract_pdf_url: string | null; contract_pdf_urls: string[] | null }[]) {
      if (s.contract_pdf_url) ownedUrls.add(s.contract_pdf_url);
      for (const u of s.contract_pdf_urls ?? []) ownedUrls.add(u);
    }
    if (!ownedUrls.has(pdf_url)) {
      return new Response(JSON.stringify({ error: "Forbidden: pdf_url not associated with an accessible billing schedule" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 403,
      });
    }

    // Fetch PDF as base64
    const pdfRes = await fetch(pdf_url);
    if (!pdfRes.ok) {
      return new Response(JSON.stringify({ error: `Failed to fetch PDF: ${pdfRes.status}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }
    const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());
    // Base64-encode in chunks to avoid call-stack overflow on large PDFs
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < pdfBytes.length; i += CHUNK) {
      binary += String.fromCharCode(...pdfBytes.subarray(i, i + CHUNK));
    }
    const pdfB64 = btoa(binary);

    // Call Claude
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const resp = await anthropic.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 16000,
      system: SOV_SYSTEM_PROMPT,
      tools: [SOV_TOOL],
      tool_choice: { type: "tool", name: "submit_sov" },
      messages: [{
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: pdfB64 },
          },
          { type: "text", text: "Extract the Schedule of Values from this document using submit_sov." },
        ],
      }],
    });

    const toolUse = resp.content.find((b: { type: string }) => b.type === "tool_use") as
      | { type: "tool_use"; name: string; input: unknown } | undefined;
    if (!toolUse) {
      return new Response(JSON.stringify({ error: "Model did not call the extraction tool", raw: resp }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 502,
      });
    }

    return new Response(JSON.stringify({ extraction: toolUse.input, usage: resp.usage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("extract-sov error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
