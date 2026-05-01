// Shared tenant-auth helpers for Supabase Edge Functions.
//
// Every money- or tenant-scoped function must:
//   1. Verify the caller is authenticated (or is the service role for internal calls).
//   2. Resolve the caller's tenant_id from team_members.
//   3. Assert any DB row touched by the function belongs to that tenant_id.
//
// The audit on 2026-04-30 found that 6 money/admin functions skipped step 3.
// Use these helpers consistently to prevent regressions.

export type CallerContext =
  | { ok: true; isServiceRole: true; userId: null; tenantId: null }
  | { ok: true; isServiceRole: false; userId: string; tenantId: string }
  | { ok: false; status: 401 | 403; reason: string };

/**
 * Authenticate the caller and resolve their tenant_id.
 *
 * - Returns `isServiceRole: true` when the request bears the service role key
 *   (used by stripe-webhook -> qb-record-payment internal calls). The caller
 *   is then trusted; downstream code MUST still scope its DB lookups to the
 *   row's own tenant_id.
 * - Returns `isServiceRole: false` with a resolved tenantId when a user JWT
 *   maps to an active team_members row.
 * - Returns ok:false with a status if auth fails or the user has no tenant.
 */
export async function authenticateCaller(
  sb: any,
  req: Request,
  serviceRoleKey: string,
): Promise<CallerContext> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return { ok: false, status: 401, reason: "Missing authorization" };

  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return { ok: false, status: 401, reason: "Missing bearer token" };

  if (token === serviceRoleKey) {
    return { ok: true, isServiceRole: true, userId: null, tenantId: null };
  }

  const { data: userResult, error: authErr } = await sb.auth.getUser(token);
  const user = userResult?.user;
  if (authErr || !user) return { ok: false, status: 401, reason: "Invalid token" };

  const { data: tm, error: tmErr } = await sb
    .from("team_members")
    .select("tenant_id, role, active")
    .eq("auth_id", user.id)
    .maybeSingle();

  if (tmErr || !tm) return { ok: false, status: 403, reason: "No team membership" };
  if (tm.active === false) return { ok: false, status: 403, reason: "Inactive user" };
  if (!tm.tenant_id) return { ok: false, status: 403, reason: "User has no tenant" };

  return { ok: true, isServiceRole: false, userId: user.id, tenantId: tm.tenant_id };
}

/**
 * Resolve role + tenant for a caller. Used by admin-only functions (qb-auth,
 * invite-user, etc.) that must assert role === 'admin' or 'manager'.
 */
export async function requireAdminOrManager(
  sb: any,
  req: Request,
  serviceRoleKey: string,
): Promise<
  | { ok: true; isServiceRole: true; userId: null; tenantId: null; role: null }
  | { ok: true; isServiceRole: false; userId: string; tenantId: string; role: string }
  | { ok: false; status: 401 | 403; reason: string }
> {
  const ctx = await authenticateCaller(sb, req, serviceRoleKey);
  if (!ctx.ok) return ctx;
  if (ctx.isServiceRole) return { ...ctx, role: null };

  const { data: tm } = await sb
    .from("team_members")
    .select("role")
    .eq("auth_id", ctx.userId)
    .maybeSingle();

  const role = tm?.role;
  if (role !== "admin" && role !== "manager") {
    return { ok: false, status: 403, reason: "Admin or manager role required" };
  }
  return { ...ctx, role };
}

/**
 * Standard 401/403 JSON response for an unauthenticated/unauthorized caller.
 * Returns a generic message to avoid leaking whether the user exists.
 */
export function unauthorizedResponse(
  status: 401 | 403,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({ error: status === 401 ? "Unauthorized" : "Forbidden" }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
