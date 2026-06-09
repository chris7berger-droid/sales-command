// Shared CORS resolver — S7 (T1 security remediation, Loop #33).
//
// Replaces the per-function `origin.endsWith(".vercel.app")` substring match
// (audit C1/A1) and the `http://localhost` allowance (audit C17) with an
// EXACT-host allowlist. No wildcard origin is ever reflected.
//
// Preview / Vercel deploys are tested by pinning their EXACT origin in the
// `PREVIEW_ORIGINS` function secret (comma-separated, full `https://` origins,
// no trailing slash), then clearing it after the testing window. Unset in prod.
//
// NOTE (scope): this helper intentionally does NOT emit
// `Access-Control-Allow-Methods` — that is ADJ-4 (audit C18), filed and out of
// scope for this loop. If picked up later it is a one-line add here.

const BASE_ALLOWED_ORIGINS = [
  "https://salescommand.app",
  "https://www.salescommand.app",
  "https://www.scmybiz.com",
  "https://scmybiz.com",
];

const DEFAULT_ALLOW_HEADERS = "authorization, x-client-info, apikey, content-type";

function resolveAllowedOrigin(req: Request, extraOrigins: string[]): string {
  const origin = req.headers.get("origin") || "";
  // Unset PREVIEW_ORIGINS → "".split(",") = [""], so filter(Boolean) is required
  // to avoid injecting an empty string into the allowlist.
  const previewOrigins = (Deno.env.get("PREVIEW_ORIGINS") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowlist = [...BASE_ALLOWED_ORIGINS, ...extraOrigins, ...previewOrigins];
  // An origin-less request (origin === "") must NEVER match — short-circuit it
  // so a stray empty allowlist entry can't treat it as allowed.
  const isAllowed = origin !== "" && allowlist.includes(origin);
  return isAllowed ? origin : BASE_ALLOWED_ORIGINS[0];
}

/**
 * Build the CORS headers for an edge-function response.
 *
 * @param req            the incoming request (read for its Origin header)
 * @param opts.extraAllowHeaders  request headers to append to Access-Control-Allow-Headers
 *                                (e.g. ["stripe-signature"] for the webhooks)
 * @param opts.extraOrigins       additional exact origins this function trusts
 *                                beyond the four Sales Command production hosts
 *                                (e.g. reset-password also serves Schedule Command)
 */
export function buildCorsHeaders(
  req: Request,
  opts: { extraAllowHeaders?: string[]; extraOrigins?: string[] } = {},
): Record<string, string> {
  const { extraAllowHeaders = [], extraOrigins = [] } = opts;
  const allowHeaders = extraAllowHeaders.length
    ? `${DEFAULT_ALLOW_HEADERS}, ${extraAllowHeaders.join(", ")}`
    : DEFAULT_ALLOW_HEADERS;
  return {
    "Access-Control-Allow-Origin": resolveAllowedOrigin(req, extraOrigins),
    "Access-Control-Allow-Headers": allowHeaders,
  };
}
