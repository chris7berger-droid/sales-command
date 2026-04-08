import { createClient } from "@supabase/supabase-js";
import { PostgrestClient } from "@supabase/postgrest-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://pbgvgjjuhnpsumnowuym.supabase.co";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_v7XktVvkAlX7y5f6xoFjng_AaLaWKoK";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Archive schema access via raw PostgREST client — no second GoTrueClient
const _archiveRest = new PostgrestClient(`${SUPABASE_URL}/rest/v1`, {
  headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  schema: "archive",
});
export const archiveDb = { from: (table) => _archiveRest.from(table) };