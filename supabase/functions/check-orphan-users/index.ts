import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

serve(async (_req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data, error } = await supabase
      .rpc("get_orphan_auth_user_count");

    if (error) {
      console.error("Failed to query orphan users:", error.message);
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    const count = data ?? 0;
    console.log(`Orphan auth user check: ${count} orphans found`);

    if (count > 0 && RESEND_API_KEY) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Sales Command Alerts <noreply@salescommand.app>",
          to: "chris7berger@gmail.com",
          subject: `⚠️ ${count} orphan auth user(s) detected`,
          html: `<p>${count} auth user(s) exist without a matching team_members row. Check <code>private.v_orphan_auth_users</code> in Supabase.</p>`,
        }),
      });
    }

    return new Response(JSON.stringify({ orphan_count: count }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("check-orphan-users error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});
