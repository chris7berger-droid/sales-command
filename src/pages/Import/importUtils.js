/*  importUtils.js — field definitions, auto-match, and transformations
 *  DB column names come from CLAUDE.md, NOT the build spec.
 */

/* ── US state name → 2-letter code ── */
const STATE_MAP = {
  alabama:"AL",alaska:"AK",arizona:"AZ",arkansas:"AR",california:"CA",
  colorado:"CO",connecticut:"CT",delaware:"DE",florida:"FL",georgia:"GA",
  hawaii:"HI",idaho:"ID",illinois:"IL",indiana:"IN",iowa:"IA",kansas:"KS",
  kentucky:"KY",louisiana:"LA",maine:"ME",maryland:"MD",massachusetts:"MA",
  michigan:"MI",minnesota:"MN",mississippi:"MS",missouri:"MO",montana:"MT",
  nebraska:"NE",nevada:"NV","new hampshire":"NH","new jersey":"NJ",
  "new mexico":"NM","new york":"NY","north carolina":"NC","north dakota":"ND",
  ohio:"OH",oklahoma:"OK",oregon:"OR",pennsylvania:"PA","rhode island":"RI",
  "south carolina":"SC","south dakota":"SD",tennessee:"TN",texas:"TX",
  utah:"UT",vermont:"VT",virginia:"VA",washington:"WA","west virginia":"WV",
  wisconsin:"WI",wyoming:"WY","district of columbia":"DC",
};
const VALID_CODES = new Set(Object.values(STATE_MAP));

/* ── Target field definitions per data type ──
 *  `column` = actual Supabase column (from CLAUDE.md)
 */
export const TARGET_FIELDS = {
  customers: [
    { key: "name",             label: "Customer / Company Name", column: "name",             type: "text",  required: true },
    { key: "customer_type",    label: "Customer Type",           column: "customer_type",    type: "text",  required: false },
    { key: "first_name",       label: "Contact First Name",     column: "first_name",       type: "text",  required: false },
    { key: "last_name",        label: "Contact Last Name",      column: "last_name",        type: "text",  required: false },
    { key: "phone",            label: "Phone",                  column: "phone",            type: "phone", required: false },
    { key: "email",            label: "Email",                  column: "email",            type: "email", required: false },
    { key: "contact_phone",    label: "Contact Phone",          column: "contact_phone",    type: "phone", required: false },
    { key: "contact_email",    label: "Contact Email",          column: "contact_email",    type: "email", required: false },
    { key: "business_address", label: "Business Address",       column: "business_address", type: "text",  required: false },
    { key: "business_city",    label: "City",                   column: "business_city",    type: "text",  required: false },
    { key: "business_state",   label: "State",                  column: "business_state",   type: "state", required: false },
    { key: "business_zip",     label: "Zip",                    column: "business_zip",     type: "zip",   required: false },
    { key: "billing_same",     label: "Billing Same as Business", column: "billing_same",   type: "bool",  required: false },
    { key: "billing_name",     label: "Billing Name",           column: "billing_name",     type: "text",  required: false },
    { key: "billing_phone",    label: "Billing Phone",          column: "billing_phone",    type: "phone", required: false },
    { key: "billing_email",    label: "Billing Email",          column: "billing_email",    type: "email", required: false },
    { key: "billing_terms",    label: "Billing Terms (days)",   column: "billing_terms",    type: "int",   required: false },
  ],
};

/* ── Auto-match rules ──
 *  Each rule: { patterns: [lowercase substrings], target: field key, confidence: "high"|"medium"|"low" }
 *  Checked in order — first match wins per source header.
 */
const AUTO_MATCH_RULES = {
  customers: [
    { patterns: ["customer name", "company name", "client name", "account name", "customer", "company", "client", "account"], target: "name", confidence: "high" },
    { patterns: ["customer type", "type", "category"],            target: "customer_type",    confidence: "medium" },
    { patterns: ["first name", "first", "contact first"],         target: "first_name",       confidence: "high" },
    { patterns: ["last name", "last", "surname", "contact last"], target: "last_name",        confidence: "high" },
    { patterns: ["contact phone", "mobile", "cell"],              target: "contact_phone",    confidence: "medium" },
    { patterns: ["contact email", "contact e-mail"],              target: "contact_email",    confidence: "high" },
    { patterns: ["phone", "tel", "telephone"],                    target: "phone",            confidence: "high" },
    { patterns: ["email", "e-mail"],                              target: "email",            confidence: "high" },
    { patterns: ["address", "street", "address 1", "addr"],       target: "business_address", confidence: "medium" },
    { patterns: ["city", "town"],                                 target: "business_city",    confidence: "high" },
    { patterns: ["state", "province", "st"],                      target: "business_state",   confidence: "high" },
    { patterns: ["zip", "postal", "zip code", "zipcode"],         target: "business_zip",     confidence: "high" },
    { patterns: ["billing name"],                                 target: "billing_name",     confidence: "high" },
    { patterns: ["billing phone"],                                target: "billing_phone",    confidence: "high" },
    { patterns: ["billing email"],                                target: "billing_email",    confidence: "high" },
    { patterns: ["billing terms", "net", "payment terms", "terms"], target: "billing_terms", confidence: "medium" },
  ],
};

/* ── Auto-match algorithm ── */
export function autoMatch(headers, dataType) {
  const rules = AUTO_MATCH_RULES[dataType] || [];
  const mappings = {};          // sourceHeader → { target, confidence }
  const usedTargets = new Set();

  // Sort rules so longer patterns match first (more specific beats less specific)
  const sortedRules = [...rules].sort((a, b) => {
    const maxA = Math.max(...a.patterns.map(p => p.length));
    const maxB = Math.max(...b.patterns.map(p => p.length));
    return maxB - maxA;
  });

  for (const header of headers) {
    const h = header.toLowerCase().trim();
    for (const rule of sortedRules) {
      if (usedTargets.has(rule.target)) continue;
      const matched = rule.patterns.some((p) => h === p || h.includes(p));
      if (matched) {
        mappings[header] = { target: rule.target, confidence: rule.confidence };
        usedTargets.add(rule.target);
        break;
      }
    }
  }
  return mappings;
}

/* ── Field transformations ── */

export function transformValue(value, fieldType) {
  if (value == null || value === "") return value;
  const v = String(value).trim();
  if (!v) return "";

  switch (fieldType) {
    case "phone":  return formatPhone(v);
    case "email":  return v.toLowerCase();
    case "state":  return normalizeState(v);
    case "zip":    return normalizeZip(v);
    case "money":  return parseMoney(v);
    case "date":   return parseDate(v);
    case "int":    return parseIntSafe(v);
    case "bool":   return parseBool(v);
    default:       return v;
  }
}

function formatPhone(v) {
  const digits = v.replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") {
    const d = digits.slice(1);
    return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  }
  return v; // return as-is if not 10 digits
}

function normalizeState(v) {
  const upper = v.toUpperCase().trim();
  if (upper.length === 2 && VALID_CODES.has(upper)) return upper;
  const fromName = STATE_MAP[v.toLowerCase().trim()];
  return fromName || v;
}

function normalizeZip(v) {
  const cleaned = v.replace(/[^\d-]/g, "");
  if (/^\d{5}(-\d{4})?$/.test(cleaned)) return cleaned;
  if (/^\d{5,9}$/.test(cleaned)) return cleaned.slice(0, 5);
  return v;
}

function parseMoney(v) {
  const cleaned = v.replace(/[$,\s]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? v : num.toFixed(2);
}

function parseDate(v) {
  // Excel serial number
  if (/^\d{5}$/.test(v)) {
    const d = new Date((parseInt(v) - 25569) * 86400 * 1000);
    return d.toISOString().slice(0, 10);
  }
  // Already a Date object (from SheetJS cellDates)
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  // Try native parse
  const d = new Date(v);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return v;
}

function parseIntSafe(v) {
  const n = parseInt(v, 10);
  return isNaN(n) ? v : String(n);
}

function parseBool(v) {
  const lower = String(v).toLowerCase().trim();
  if (["true", "yes", "1", "y"].includes(lower)) return "true";
  if (["false", "no", "0", "n", ""].includes(lower)) return "false";
  return v;
}

/* ── Validation helpers ── */

export function validateEmail(v) {
  if (!v) return true; // empty is ok (optional)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function validatePhone(v) {
  if (!v) return true;
  const digits = String(v).replace(/\D/g, "");
  return digits.length === 10 || digits.length === 11;
}

export function getRequiredFields(dataType) {
  return (TARGET_FIELDS[dataType] || []).filter(f => f.required);
}

export function getMissingRequired(dataType, mappings) {
  const required = getRequiredFields(dataType);
  const mappedTargets = new Set(
    Object.values(mappings).map(m => m.target).filter(Boolean)
  );
  return required.filter(f => !mappedTargets.has(f.key));
}
