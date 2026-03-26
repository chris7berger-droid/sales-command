import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const QB_CLIENT_ID = Deno.env.get("QB_CLIENT_ID");
const QB_CLIENT_SECRET = Deno.env.get("QB_CLIENT_SECRET");
const QB_REDIRECT_URI = Deno.env.get("QB_REDIRECT_URI");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, code, realmId } = await req.json();
    const basicAuth = btoa(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`);
    const sb = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    if (action === "exchange") {
      // Exchange authorization code for tokens
      if (!code || !realmId) {
        return new Response(JSON.stringify({ error: "Missing code or realmId" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        });
      }

      console.log("qb-auth: exchanging code for tokens, realmId:", realmId);

      const tokenRes = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: QB_REDIRECT_URI!,
        }).toString(),
      });

      const tokenData = await tokenRes.json();
      console.log("qb-auth: token response status:", tokenRes.status);

      if (!tokenRes.ok) {
        console.error("qb-auth: token exchange failed:", JSON.stringify(tokenData));
        return new Response(JSON.stringify({ error: tokenData.error || "Token exchange failed" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }

      // Calculate expiry (access token lasts 1 hour)
      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

      // Delete any existing connection, then insert new one
      await sb.from("qb_connection").delete().neq("id", "00000000-0000-0000-0000-000000000000");

      const { error: insertErr } = await sb.from("qb_connection").insert({
        realm_id: realmId,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      });

      if (insertErr) {
        console.error("qb-auth: DB insert error:", insertErr.message);
        return new Response(JSON.stringify({ error: "Failed to save connection" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }

      return new Response(JSON.stringify({ success: true, realmId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });

    } else if (action === "refresh") {
      // Refresh the access token
      const { data: conn } = await sb.from("qb_connection").select("*").limit(1).maybeSingle();

      if (!conn) {
        return new Response(JSON.stringify({ error: "No QB connection found" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 404,
        });
      }

      console.log("qb-auth: refreshing token for realmId:", conn.realm_id);

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
      console.log("qb-auth: refresh response status:", tokenRes.status);

      if (!tokenRes.ok) {
        console.error("qb-auth: refresh failed:", JSON.stringify(tokenData));
        return new Response(JSON.stringify({ error: tokenData.error || "Token refresh failed" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }

      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

      await sb.from("qb_connection").update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      }).eq("id", conn.id);

      return new Response(JSON.stringify({ success: true, realmId: conn.realm_id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });

    } else if (action === "status") {
      // Check connection status
      const { data: conn } = await sb.from("qb_connection").select("realm_id, token_expires_at, updated_at").limit(1).maybeSingle();

      if (!conn) {
        return new Response(JSON.stringify({ connected: false }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }

      const expired = new Date(conn.token_expires_at) < new Date();
      return new Response(JSON.stringify({
        connected: true,
        realmId: conn.realm_id,
        tokenExpired: expired,
        updatedAt: conn.updated_at,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });

    } else {
      return new Response(JSON.stringify({ error: "Invalid action. Use: exchange, refresh, or status" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

  } catch (error) {
    console.error("qb-auth error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
