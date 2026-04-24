import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const ALLOWED_ORIGINS = ["https://salescommand.app", "https://www.salescommand.app", "https://www.scmybiz.com", "https://scmybiz.com"];

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
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verify caller is authenticated
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: isAdmin, error: roleErr } = await userClient.rpc("is_admin_or_manager");
    if (roleErr || isAdmin !== true) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 403,
      });
    }

    const { data: callerRow, error: callerErr } = await supabase
      .from("team_members")
      .select("tenant_id")
      .eq("auth_id", user.id)
      .single();
    if (callerErr || !callerRow?.tenant_id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 403,
      });
    }
    const callerTenantId = callerRow.tenant_id;

    const { teamMemberId } = await req.json();

    if (!teamMemberId) {
      return new Response(JSON.stringify({ error: "teamMemberId is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // Look up the team member
    const { data: member, error: fetchErr } = await supabase
      .from("team_members")
      .select("auth_id, name, tenant_id")
      .eq("id", teamMemberId)
      .single();

    if (fetchErr) {
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    if (member.tenant_id !== callerTenantId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 403,
      });
    }

    // Revoke auth: delete all sessions and the auth user so they can't log in
    if (member?.auth_id) {
      // Delete all sessions first
      await supabase.rpc("delete_user_sessions", { target_user_id: member.auth_id }).catch(() => {});
      // Delete the auth user entirely — they'll be re-invited if reactivated
      const { error: authErr } = await supabase.auth.admin.deleteUser(member.auth_id);
      if (authErr) {
        console.error("Failed to delete auth user:", authErr.message);
      }
    }

    // Set team_members to inactive and clear auth_id (auth user is deleted)
    const { error: updateErr } = await supabase
      .from("team_members")
      .update({ active: false, auth_id: null, onboarded: false })
      .eq("id", teamMemberId);

    if (updateErr) {
      return new Response(JSON.stringify({ error: updateErr.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    // Count jobs that are now unassigned
    const { count } = await supabase
      .from("call_log")
      .select("id", { count: "exact", head: true })
      .eq("sales_name", member.name);

    return new Response(JSON.stringify({ success: true, unassignedJobs: count || 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    console.error("deactivate-user error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
