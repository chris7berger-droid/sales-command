import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { teamMemberId } = await req.json();

    if (!teamMemberId) {
      return new Response(JSON.stringify({ error: "teamMemberId is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Look up the team member to get their auth_id
    const { data: member, error: fetchErr } = await supabase
      .from("team_members")
      .select("auth_id")
      .eq("id", teamMemberId)
      .single();

    if (fetchErr) {
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // Delete the auth user if one is linked
    if (member?.auth_id) {
      const { error: authErr } = await supabase.auth.admin.deleteUser(member.auth_id);
      if (authErr) {
        console.error("Failed to delete auth user:", authErr.message);
        // Continue to delete team_members row even if auth delete fails
      }
    }

    // Delete the team_members row
    const { error: delErr } = await supabase
      .from("team_members")
      .delete()
      .eq("id", teamMemberId);

    if (delErr) {
      return new Response(JSON.stringify({ error: delErr.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    console.error("delete-user error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
