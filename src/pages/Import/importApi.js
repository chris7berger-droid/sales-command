/*  importApi.js — Supabase operations for the import tool
 *  Handles: row transformation, validation, duplicate detection, batch insert
 */

import { supabase } from "../../lib/supabase";
import { TARGET_FIELDS, transformValue, enrichCustomerRow, validateEmail, validatePhone } from "./importUtils";

const BATCH_SIZE = 50;

/* ── Build transformed rows from raw file data + mappings ── */

export function buildRows(fileData, dataType, mappings) {
  const fields = TARGET_FIELDS[dataType] || [];
  const { headers, rows } = fileData;

  return rows.map((raw, idx) => {
    const mapped = {};
    const _rawDateFields = {};
    for (const header of headers) {
      const m = mappings[header];
      if (!m?.target) continue;
      const field = fields.find(f => f.key === m.target);
      if (!field) continue;
      // Keep raw value for date fields so we can rescue text into notes
      if (field.type === "date" && raw[header]) {
        _rawDateFields[field.key] = String(raw[header]).trim();
      }
      mapped[field.key] = transformValue(raw[header], field.type);
    }
    mapped._rawDateFields = _rawDateFields;

    // Enrich customers with auto-detected type/first/last
    const enriched = dataType === "customers" ? enrichCustomerRow(mapped, mappings) : mapped;

    return { _idx: idx + 1, ...enriched };
  });
}

/* ── Call log enrichment: link customers, normalize stages, build display_job_number ── */

const VALID_STAGES = ["New Inquiry", "Wants Bid", "Has Bid", "Sold", "Lost"];
const STAGE_MAP = {
  "new inquiry": "New Inquiry", "new": "New Inquiry",
  "wants bid": "Wants Bid", "wants": "Wants Bid",
  "has bid": "Has Bid", "has": "Has Bid",
  "sold": "Sold", "won": "Sold", "closed": "Sold",
  "lost": "Lost", "dead": "Lost",
};

function normalizeStage(v) {
  if (!v) return "New Inquiry";
  const lower = v.toLowerCase().trim();
  if (STAGE_MAP[lower]) return STAGE_MAP[lower];
  // Try partial match
  for (const [key, val] of Object.entries(STAGE_MAP)) {
    if (lower.includes(key)) return val;
  }
  return "New Inquiry";
}

export async function enrichCallLogRows(rows) {
  // Fetch existing customers for linking
  const { data: customers } = await supabase
    .from("customers")
    .select("id, name")
    .range(0, 4999);

  const custMap = {};
  for (const c of (customers || [])) {
    custMap[c.name.toLowerCase().trim()] = c.id;
  }

  // Fetch work types for linking
  const { data: workTypes } = await supabase
    .from("work_types")
    .select("id, name");

  const wtMap = {};
  for (const wt of (workTypes || [])) {
    wtMap[wt.name.toLowerCase().trim()] = wt.id;
  }

  // Get next job number
  const { data: lastJob } = await supabase
    .from("call_log")
    .select("job_number")
    .order("job_number", { ascending: false })
    .limit(1);
  let nextNum = (lastJob && lastJob.length > 0) ? (lastJob[0].job_number || 9999) + 1 : 10000;

  return rows.map((row) => {
    const enriched = { ...row };

    // Fill customer_name from job_name if missing
    if (!enriched.customer_name && enriched.job_name) {
      enriched.customer_name = enriched.job_name;
    }

    // Link customer by name
    const custName = (enriched.customer_name || "").toLowerCase().trim();
    enriched._customer_id = custMap[custName] || null;

    // Rescue non-date text from date fields into notes
    const rawDates = row._rawDateFields || {};
    const rescuedNotes = [];
    for (const [field, rawVal] of Object.entries(rawDates)) {
      if (rawVal && enriched[field] == null) {
        rescuedNotes.push(`${field}: ${rawVal}`);
      }
    }
    if (rescuedNotes.length > 0) {
      const existing = enriched.notes ? enriched.notes + "\n" : "";
      enriched.notes = existing + rescuedNotes.join("\n");
    }
    delete enriched._rawDateFields;

    // Normalize stage
    enriched.stage = normalizeStage(row.stage);

    // Assign job number if not provided
    if (!enriched.job_number) {
      enriched.job_number = nextNum++;
    } else {
      const parsed = parseInt(enriched.job_number, 10);
      if (!isNaN(parsed)) {
        enriched.job_number = parsed;
        if (parsed >= nextNum) nextNum = parsed + 1;
      }
    }

    // Build display_job_number
    const displayName = enriched.job_name || enriched.customer_name || "";
    enriched.display_job_number = enriched.display_job_number || `${enriched.job_number} - ${displayName}`;

    // Resolve work type name to ID (stored in virtual field, handled during insert)
    const wtName = (row.work_type || "").toLowerCase().trim();
    enriched._work_type_id = wtMap[wtName] || null;

    return enriched;
  });
}

/* ── Validate rows ── */

export function validateRows(rows, dataType) {
  const fields = TARGET_FIELDS[dataType] || [];
  const required = fields.filter(f => f.required);

  return rows.map((row) => {
    const issues = [];

    // Required field check
    for (const f of required) {
      const v = row[f.key];
      if (v == null || String(v).trim() === "") {
        issues.push({ field: f.label, level: "error", msg: `${f.label} is required` });
      }
    }

    // Type-specific validation
    for (const f of fields) {
      const v = row[f.key];
      if (v == null || String(v).trim() === "") continue;

      if (f.type === "email" && !validateEmail(v)) {
        issues.push({ field: f.label, level: "error", msg: `Invalid email: ${v}` });
      }
      if (f.type === "phone" && !validatePhone(v)) {
        const digits = String(v).replace(/\D/g, "");
        if (digits.length > 0) {
          issues.push({ field: f.label, level: "warning", msg: `Phone has ${digits.length} digits (expected 10)` });
        }
      }
      if (f.type === "state" && v.length !== 2) {
        issues.push({ field: f.label, level: "warning", msg: `State "${v}" not recognized` });
      }
      if (f.type === "zip" && !/^\d{5}(-\d{4})?$/.test(v)) {
        issues.push({ field: f.label, level: "warning", msg: `Unusual zip format: ${v}` });
      }
    }

    // Classify: error if any error-level issue, warning if any warning, else clean
    const hasError = issues.some(i => i.level === "error");
    const hasWarning = issues.some(i => i.level === "warning");
    const status = hasError ? "error" : hasWarning ? "warning" : "clean";

    return { ...row, _status: status, _issues: issues };
  });
}

/* ── Duplicate detection against existing Supabase data ── */

export async function detectDuplicates(rows, dataType) {
  if (dataType === "call_log") {
    const { data: existing } = await supabase
      .from("call_log")
      .select("id, job_number, display_job_number")
      .range(0, 4999);
    if (!existing || existing.length === 0) return rows.map(r => ({ ...r, _duplicate: null }));
    const byNum = {};
    for (const e of existing) byNum[e.job_number] = e;
    return rows.map((row) => {
      const num = parseInt(row.job_number, 10);
      return { ...row, _duplicate: (num && byNum[num]) ? byNum[num] : null };
    });
  }
  if (dataType !== "customers") return rows.map(r => ({ ...r, _duplicate: null }));

  // Fetch existing customers
  const { data: existing, error } = await supabase
    .from("customers")
    .select("id, name, phone, email")
    .range(0, 4999);

  if (error || !existing) return rows.map(r => ({ ...r, _duplicate: null }));

  const normalize = (s) => (s || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "");

  return rows.map((row) => {
    const incomingName = normalize(row.name);
    if (!incomingName) return { ...row, _duplicate: null };

    // Try exact name match first
    let match = existing.find(e => normalize(e.name) === incomingName);

    // If no exact match, try phone or email
    if (!match && row.phone) {
      const incomingPhone = (row.phone || "").replace(/\D/g, "");
      match = existing.find(e => e.phone && e.phone.replace(/\D/g, "") === incomingPhone);
    }
    if (!match && row.email) {
      const incomingEmail = (row.email || "").toLowerCase().trim();
      match = existing.find(e => e.email && e.email.toLowerCase().trim() === incomingEmail);
    }

    return { ...row, _duplicate: match || null };
  });
}

/* ── Batch insert to Supabase ── */

export async function importRows(rows, dataType, onProgress) {
  // Only import rows that are clean or warning, and not skipped
  const toInsert = rows.filter(r => r._status !== "error" && r._action !== "skip");

  // Strip internal/virtual fields before inserting
  const internalKeys = ["_idx", "_status", "_issues", "_duplicate", "_action", "_customer_id", "_work_type_id", "_rawDateFields", "work_type", "prevailing_wage"];
  const cleanRow = (row) => {
    const cleaned = {};
    for (const [k, v] of Object.entries(row)) {
      if (internalKeys.includes(k)) continue;
      if (v != null && String(v).trim() !== "") {
        if (k === "billing_terms") {
          const n = parseInt(v, 10);
          cleaned[k] = isNaN(n) ? 30 : n;
        } else if (k === "billing_same") {
          cleaned[k] = v === "true";
        } else if (k === "job_number") {
          cleaned[k] = parseInt(v, 10) || v;
        } else {
          cleaned[k] = v;
        }
      }
    }
    // Add customer_id for call_log
    if (dataType === "call_log" && row._customer_id) {
      cleaned.customer_id = row._customer_id;
    }
    return cleaned;
  };

  const results = { imported: 0, skipped: 0, errored: 0, merged: 0, errors: [] };
  const total = toInsert.length;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    const inserts = [];
    const merges = [];

    for (const row of batch) {
      if (row._action === "merge" && row._duplicate) {
        merges.push({ id: row._duplicate.id, data: cleanRow(row) });
      } else {
        inserts.push(cleanRow(row));
      }
    }

    // Handle inserts
    if (inserts.length > 0) {
      const { data: inserted, error } = await supabase.from(getTable(dataType)).insert(inserts).select("id, job_number");
      if (error) {
        results.errored += inserts.length;
        results.errors.push({ batch: Math.floor(i / BATCH_SIZE) + 1, msg: error.message });
      } else {
        results.imported += (inserted || inserts).length;

        // Insert job_work_types for call_log rows that have a work type
        if (dataType === "call_log" && inserted) {
          const wtRows = [];
          for (let j = 0; j < batch.length; j++) {
            const srcRow = batch[j];
            if (srcRow._action === "merge") continue;
            if (!srcRow._work_type_id) continue;
            const matchedInsert = inserted.find(ins => ins.job_number === srcRow.job_number);
            if (matchedInsert) {
              wtRows.push({ call_log_id: matchedInsert.id, work_type_id: srcRow._work_type_id });
            }
          }
          if (wtRows.length > 0) {
            await supabase.from("job_work_types").insert(wtRows);
          }
        }
      }
    }

    // Handle merges (update existing records)
    for (const merge of merges) {
      const { error } = await supabase.from(getTable(dataType)).update(merge.data).eq("id", merge.id);
      if (error) {
        results.errored += 1;
        results.errors.push({ batch: Math.floor(i / BATCH_SIZE) + 1, msg: `Merge ${merge.id}: ${error.message}` });
      } else {
        results.merged += 1;
      }
    }

    onProgress(Math.min(i + BATCH_SIZE, total), total);
  }

  // Count skipped
  results.skipped = rows.filter(r => r._status === "error" || r._action === "skip").length;

  return results;
}

function getTable(dataType) {
  const map = { customers: "customers", call_log: "call_log", proposals: "proposals", invoices: "invoices" };
  return map[dataType] || dataType;
}
