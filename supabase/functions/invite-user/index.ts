import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, name, teamMemberId, senderEmail, senderName } = await req.json();

    if (!email) {
      return new Response(JSON.stringify({ error: "Email is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    console.log("invite-user invoked", { email, name, teamMemberId, senderEmail, senderName });

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Create auth user — Supabase will generate a random password
    // User will set their own password via the reset link
    const { data: userData, error: createErr } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true, // skip email verification — we trust admin added correct email
    });

    let authId = userData?.user?.id;

    if (createErr) {
      // If user already exists, look up their auth id
      if (createErr.message.includes("already been registered")) {
        const { data: { users } } = await supabase.auth.admin.listUsers();
        const existing = users?.find((u: any) => u.email === email);
        authId = existing?.id;
      } else {
        return new Response(JSON.stringify({ error: createErr.message }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        });
      }
    }

    // Link auth_id to team_members row
    if (authId && teamMemberId) {
      await supabase
        .from("team_members")
        .update({ auth_id: authId })
        .eq("id", teamMemberId);
    }

    // Generate magic link — user gets signed in and the welcome screen handles password creation
    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: "https://www.scmybiz.com" },
    });

    console.log("generateLink result:", { linkData, linkErr: linkErr?.message });

    // Build the reset URL from the link data
    let resetUrl = "";
    if (linkData?.properties?.action_link) {
      resetUrl = linkData.properties.action_link;
    }

    // Send invite email via Resend
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "Email service not configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    const firstName = name?.split(" ")[0] || "there";

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: senderEmail || "noreply@scmybiz.com",
        to: email,
        subject: `${senderName || "Your team"} invited you to Sales Command`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1c1814;">
            <div style="border-bottom: 4px solid #30cfac; padding-bottom: 16px; margin-bottom: 24px;">
              <h2 style="margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: 0.02em;">Sales Command</h2>
            </div>
            <p>Hi ${firstName},</p>
            <p>You've been invited to join <strong>Sales Command</strong>. Your username is your email address:</p>
            <p style="background: #f5f1eb; padding: 12px 16px; border-radius: 8px; font-weight: 700; font-size: 15px;">${email}</p>
            <p>Click the button below to set your password and get started.</p>
            <div style="margin: 32px 0;">
              <a href="${resetUrl}" style="background: #30cfac; color: #1c1814; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px;">Set Your Password →</a>
            </div>
            <p style="color: #887c6e; font-size: 12px;">Once you've set your password, log in at <a href="https://www.scmybiz.com" style="color: #30cfac;">scmybiz.com</a></p>
          </div>
        `,
      }),
    });

    const emailResBody = await emailRes.text();
    console.log("Invite email response:", emailRes.status, emailResBody);

    if (!emailRes.ok) {
      return new Response(JSON.stringify({ error: `Failed to send invite email: ${emailResBody}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    return new Response(JSON.stringify({ success: true, authId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    console.error("invite-user error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
