import { createClient } from "@supabase/supabase-js";
import { PostgrestClient } from "@supabase/postgrest-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://pbgvgjjuhnpsumnowuym.supabase.co";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_v7XktVvkAlX7y5f6xoFjng_AaLaWKoK";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Archive schema access via raw PostgREST client (no second GoTrueClient).
// We keep the current session's access token in a closure and rebuild the
// client per call so archive queries hit PostgREST as `authenticated`, not
// `anon`. archive.get_user_tenant_id() depends on auth.uid() resolving to
// the calling user — without a real JWT the RLS policies deny everything.
let _accessToken = null;
supabase.auth.getSession().then(({ data }) => { _accessToken = data.session?.access_token || null; });
supabase.auth.onAuthStateChange((_evt, session) => { _accessToken = session?.access_token || null; });

export const archiveDb = {
  from: (table) => new PostgrestClient(`${SUPABASE_URL}/rest/v1`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${_accessToken || SUPABASE_KEY}`,
    },
    schema: "archive",
  }).from(table),
};