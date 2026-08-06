// Turns Postgres/PostgREST errors into something an operator can act on.
//
// Two failures on 2026-08-06 put raw constraint strings in front of Chris —
// `update or delete on table "call_log" violates foreign key constraint
// "invoices_call_log_id_fkey" on table "invoices"` — which says nothing about what to do next.
//
// Returns null for anything it doesn't recognize. Callers MUST fall back to the raw message in
// that case: a wrong-but-friendly sentence is worse than an ugly accurate one.

// A record this row points at is gone. Keyed by constraint → what's missing, in job terms.
const MISSING_PARENT = {
  proposals_call_log_id_fkey:            "the job this proposal belongs to",
  invoices_call_log_id_fkey:             "the job this invoice belongs to",
  invoices_proposal_id_fkey:             "the proposal this invoice belongs to",
  invoice_lines_invoice_id_fkey:         "the invoice these lines belong to",
  invoice_lines_proposal_wtc_id_fkey:    "the work type line this invoice bills",
  proposal_wtc_proposal_id_fkey:         "the proposal this work type belongs to",
  proposal_recipients_proposal_id_fkey:  "the proposal these recipients belong to",
  invoice_recipients_invoice_id_fkey:    "the invoice these recipients belong to",
  job_work_types_call_log_id_fkey:       "the job these work types belong to",
  call_log_customer_id_fkey:             "the customer on this job",
  call_log_parent_job_id_fkey:           "the parent job of this change order",
  proposals_customer_id_fkey:            "the customer on this proposal",
  customer_contacts_customer_id_fkey:    "the customer this contact belongs to",
};

// Something still points AT this row, so it can't be deleted. Only constraints that actually
// block (NO ACTION / RESTRICT) are listed — CASCADE and SET NULL never surface here.
const BLOCKED_BY = {
  proposals_call_log_id_fkey:            "a proposal",
  invoices_call_log_id_fkey:             "an invoice",
  invoices_proposal_id_fkey:             "an invoice",
  invoices_retention_release_of_fkey:    "a retention release invoice",
  invoice_lines_proposal_wtc_id_fkey:    "an invoice line",
  call_log_customer_id_fkey:             "a job",
  call_log_parent_job_id_fkey:           "a change order",
  jobs_call_log_id_fkey:                 "a Schedule Command job",
  job_crew_job_id_fkey:                  "a crew assignment",
  time_punches_job_id_fkey:              "a crew time punch",
  daily_production_reports_job_id_fkey:  "a daily production report",
  daily_log_entries_job_id_fkey:         "a daily log entry",
  job_work_types_work_type_id_fkey:      "a job",
  proposal_wtc_work_type_id_fkey:        "a proposal",
};

export function friendlyDbError(err) {
  if (!err) return null;
  const msg = err.message || String(err);

  // "insert or update on table "proposals" violates foreign key constraint "proposals_call_log_id_fkey""
  // The row being saved points at something that no longer exists — almost always a stale page.
  const missing = /insert or update on table "[^"]+" violates foreign key constraint "([^"]+)"/.exec(msg);
  if (missing) {
    const what = MISSING_PARENT[missing[1]] || "a record this depends on";
    return `Can't save — ${what} no longer exists. It was most likely deleted or replaced in another tab. Reload the page and try again.`;
  }

  // "update or delete on table "call_log" violates foreign key constraint "invoices_call_log_id_fkey" on table "invoices""
  const blocked = /update or delete on table "[^"]+" violates foreign key constraint "([^"]+)" on table "([^"]+)"/.exec(msg);
  if (blocked) {
    const what = BLOCKED_BY[blocked[1]] || `something in ${blocked[2]}`;
    return `Can't delete — ${what} still points at this record and has to be removed first.`;
  }

  if (err.code === "23505" || /duplicate key value/.test(msg)) {
    return "Can't save — a record with these details already exists. Someone may have created it in another tab.";
  }
  if (err.code === "23502" || /null value in column/.test(msg)) {
    const col = /null value in column "([^"]+)"/.exec(msg)?.[1];
    return col
      ? `Can't save — "${col}" is required and came through empty.`
      : "Can't save — a required field came through empty.";
  }
  if (err.code === "42501" || /row-level security/i.test(msg)) {
    return "Can't save — your account doesn't have permission for this. If that's wrong, it's a policy issue, not something you can fix from here.";
  }

  return null;
}

// Convenience for the common `alert`/`setError` shape: friendly text when we know it,
// the raw message when we don't, prefixed so it's clear which operation failed.
export function dbErrorText(err, prefix) {
  const friendly = friendlyDbError(err);
  if (friendly) return friendly;
  const raw = err?.message || String(err);
  return prefix ? `${prefix}: ${raw}` : raw;
}
