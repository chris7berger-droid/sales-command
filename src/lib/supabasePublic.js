// Public Supabase client for signing/invoice pages.
// Carries a custom token header that RLS policies check.
//
// Use:
//   import { createPublicClient } from "../lib/supabasePublic";
//   const sb = createPublicClient({ signingToken: token });
//
// The returned client is a fresh Supabase client with the token
// pinned in its global headers. Use it instead of the default
// import { supabase } on the public pages.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://pbgvgjjuhnpsumnowuym.supabase.co";

const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_LL6wYC7kJDPQfGYeKAaLaWKoK";

/**
 * Create a Supabase client scoped to a single public token.
 *
 * @param {Object} opts
 * @param {string} [opts.signingToken] - proposal signing token (sets x-signing-token header)
 * @param {string} [opts.viewingToken] - invoice viewing token (sets x-viewing-token header)
 * @returns {import("@supabase/supabase-js").SupabaseClient}
 */
export function createPublicClient({ signingToken, viewingToken } = {}) {
  const headers = {};
  if (signingToken) headers["x-signing-token"] = signingToken;
  if (viewingToken) headers["x-viewing-token"] = viewingToken;

  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers },
    auth: {
      // Public pages should never share an admin session.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
