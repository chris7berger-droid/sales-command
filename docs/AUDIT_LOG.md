# Audit Log

Append one row per artifact reviewed by the audit terminal. Build terminal commits this file on its next pass.

| Date | Artifact | Findings | Severity mix | Outcome | Pattern tag |
|------|----------|----------|--------------|---------|-------------|
| 2026-05-09 | PR #19 (54a1409 + f02c77d → squashed as e662d24 on main) | 5 | 2 Med, 3 Low | changed | defense-in-depth-gaps |
| 2026-05-10 | PR #19 smoke plan | 2 | 1 Med, 1 Low | deferred | protocol-theater |

## 2026-05-10 — PR #19 smoke plan notes

Step 3a executed; Steps 3b and 3c not executed.

Step 3a — `qb-search-customers` invoked from the live app via the
Link-to-Existing flow on a real job (CallLogDetail → Connect to
QuickBooks → Link to Existing → search "kal"). Returned a populated
result list (KalB Industries Of Nevada parent + multiple
sub-customers). The modal was cancelled without selecting a result.

What 3a proves:
- The deployed `qb-search-customers` function loads.
- `authenticateCaller` wiring (introduced PR #19) accepts a real user
  session and rejects nothing it shouldn't.
- `getQBToken(sb, tenantId)` resolves for the current tenant.
- Token-refresh persistence does not false-fail (the request would
  have errored if the refresh write missed its row).

What 3a does NOT prove:
- 3a is deploy-health, not security validation.
- 3a may have refreshed QB tokens in `qb_connection` (side effect of
  `getQBToken` when the access token is near expiry) — this is an
  expected and intended side effect, not a violation of "read-only".
- 3a does not prove cross-tenant isolation. A second tenant would be
  required to confirm `qb_connection.tenant_id` scoping actually
  rejects another tenant's caller. With the app at single tenant,
  this remains untested.
- 3a does not prove RLS behavior across tenants for any of the
  PR #19 surface (`qb-create-job`, `qb-link-customer`,
  `send-pay-app`).
- 3a does not exercise the full C9 fix (recipient allowlist,
  attachment-URL allowlist, server-derived sender, DB-only PDF
  URLs, payApp ↔ invoice tenant assertions, payApp.invoice_id ===
  invoiceId).

Steps 3b and 3c — not executed. Both require a safe internal test
fixture (test customer + test pay-app + test invoice with a non-real
recipient destination). No such fixture exists at single tenant.
Re-run when a fixture is available, or when the second tenant onboards
under F7 and naturally creates one.

Hard limits respected this session:
- No live customer emails sent.
- No mutations to real billing, pay-app, invoice, customer, or
  call_log rows.
- No QB link/create against live data (no `qb-create-job`,
  no `qb-link-customer` mutating writes).
- No product code changes.
- No deploys.

Pattern tag rationale (`protocol-theater`): the original v104 smoke
plan named three steps. Two of the three are unrunnable at single
tenant without building scaffolding the audit would also need to
validate. Booking the deferral keeps the gap visible instead of
implying "smoke = security verified."
