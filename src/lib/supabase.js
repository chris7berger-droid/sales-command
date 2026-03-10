import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://pbgvgjjuhnpsumnowuym.supabase.co";
const SUPABASE_KEY = "sb_publishable_v7XktVvkAlX7y5f6xoFjng_AaLaWKoK";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);