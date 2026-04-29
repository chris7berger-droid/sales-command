import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const ALLOWED_ORIGINS = [
  "https://salescommand.app", "https://www.salescommand.app",
  "https://www.scmybiz.com", "https://scmybiz.com",
  "https://schedulecommand.com", "https://www.schedulecommand.com",
  "https://www.schmybiz.com", "https://schmybiz.com",
];

// Simple in-memory rate limit: max 3 requests per email per 15 minutes
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 15 * 60 * 1000;

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
    const { email } = await req.json();

    if (!email) {
      return new Response(JSON.stringify({ error: "Email is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // Rate limit by email
    const key = email.toLowerCase().trim();
    const now = Date.now();
    const hits = (rateLimitMap.get(key) || []).filter(t => now - t < RATE_WINDOW_MS);
    if (hits.length >= RATE_LIMIT) {
      // Return success to avoid revealing rate-limit state
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }
    hits.push(now);
    rateLimitMap.set(key, hits);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Check if user exists — don't reveal if they don't (security)
    const { data: { users } } = await supabase.auth.admin.listUsers();
    const userExists = users?.find((u: any) => u.email === email.toLowerCase());
    if (!userExists) {
      // Return success even if user doesn't exist (prevent email enumeration)
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Determine app context from calling origin
    const isSchedule = origin.includes("schmybiz") || origin.includes("schedulecommand");
    const appName = isSchedule ? "Schedule Command" : "Sales Command";
    const redirectUrl = isSchedule ? "https://schedulecommand.com" : "https://salescommand.app";
    const fromEmail = isSchedule ? "noreply@schedulecommand.com" : "noreply@salescommand.app";

    // Generate recovery link via admin API
    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: redirectUrl },
    });

    if (linkErr) {
      console.error("generateLink error:", linkErr.message);
      return new Response(JSON.stringify({ error: "Failed to generate reset link" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    const resetUrl = linkData?.properties?.action_link || "";
    if (!resetUrl) {
      return new Response(JSON.stringify({ error: "Failed to generate reset link" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "Email service not configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: email,
        subject: `Reset your ${appName} password`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1c1814;">
            <div style="border-bottom: 4px solid #30cfac; padding-bottom: 16px; margin-bottom: 24px;">
              <h2 style="margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: 0.02em;">${appName}</h2>
            </div>
            <p>We received a request to reset your password.</p>
            <p>Click the button below to set a new password:</p>
            <div style="margin: 32px 0;">
              <a href="${resetUrl}" style="background: #30cfac; color: #1c1814; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px;">Reset Password →</a>
            </div>
            <p style="color: #887c6e; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>
            <p style="color: #887c6e; font-size: 12px;">Log in at <a href="${redirectUrl}" style="color: #30cfac;">${redirectUrl.replace("https://www.", "")}</a></p>
          </div>
        `,
      }),
    });

    const emailResBody = await emailRes.text();
    console.log("Reset email response:", emailRes.status, emailResBody);

    if (!emailRes.ok) {
      return new Response(JSON.stringify({ error: `Failed to send reset email: ${emailResBody}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    console.error("reset-password error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
