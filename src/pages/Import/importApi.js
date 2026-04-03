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
    for (const header of headers) {
      const m = mappings[header];
      if (!m?.target) continue;
      const field = fields.find(f => f.key === m.target);
      if (!field) continue;
      mapped[field.key] = transformValue(raw[header], field.type);
    }

    // Enrich customers with auto-detected type/first/last
    const enriched = dataType === "customers" ? enrichCustomerRow(mapped, mappings) : mapped;

    return { _idx: idx + 1, ...enriched };
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

  // Strip internal fields before inserting
  const internalKeys = ["_idx", "_status", "_issues", "_duplicate", "_action"];
  const cleanRow = (row) => {
    const cleaned = {};
    for (const [k, v] of Object.entries(row)) {
      if (internalKeys.includes(k)) continue;
      if (v != null && String(v).trim() !== "") {
        // Convert billing_terms to integer for DB
        if (k === "billing_terms") {
          const n = parseInt(v, 10);
          cleaned[k] = isNaN(n) ? 30 : n;
        } else if (k === "billing_same") {
          cleaned[k] = v === "true";
        } else {
          cleaned[k] = v;
        }
      }
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
      const { error } = await supabase.from(getTable(dataType)).insert(inserts);
      if (error) {
        results.errored += inserts.length;
        results.errors.push({ batch: Math.floor(i / BATCH_SIZE) + 1, msg: error.message });
      } else {
        results.imported += inserts.length;
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
