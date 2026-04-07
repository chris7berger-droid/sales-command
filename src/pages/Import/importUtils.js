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
  call_log: [
    { key: "job_number",         label: "Job Number",          column: "job_number",         type: "int",   required: false },
    { key: "display_job_number", label: "Display Job Number",  column: "display_job_number", type: "text",  required: false },
    { key: "customer_name",      label: "Customer Name",       column: "customer_name",      type: "text",  required: true },
    { key: "job_name",           label: "Project / Job Name",  column: "job_name",           type: "text",  required: false },
    { key: "sales_name",         label: "Sales Rep",           column: "sales_name",         type: "text",  required: false },
    { key: "stage",              label: "Stage",               column: "stage",              type: "text",  required: false },
    { key: "jobsite_address",    label: "Jobsite Address",     column: "jobsite_address",    type: "text",  required: false },
    { key: "jobsite_city",       label: "Jobsite City",        column: "jobsite_city",       type: "text",  required: false },
    { key: "jobsite_state",      label: "Jobsite State",       column: "jobsite_state",      type: "state", required: false },
    { key: "jobsite_zip",        label: "Jobsite Zip",         column: "jobsite_zip",        type: "zip",   required: false },
    { key: "bid_due",            label: "Bid Due Date",        column: "bid_due",            type: "date",  required: false },
    { key: "follow_up",          label: "Follow Up Date",      column: "follow_up",          type: "date",  required: false },
    { key: "notes",              label: "Notes",               column: "notes",              type: "text",  required: false },
    { key: "work_type",          label: "Work Type",           column: null,                 type: "text",  required: false, virtual: true },
    { key: "created_at",         label: "Date Created",        column: "created_at",         type: "date",  required: false },
    { key: "customer_type",      label: "Customer Type",       column: "customer_type",      type: "text",  required: false },
    { key: "prevailing_wage",    label: "Prevailing Wage",     column: null,                 type: "text",  required: false, virtual: true },
  ],
};

/* ── Auto-match rules ──
 *  Each rule: { patterns: [lowercase substrings], target: field key, confidence: "high"|"medium"|"low" }
 *  Checked in order — first match wins per source header.
 */
const AUTO_MATCH_RULES = {
  customers: [
    { patterns: ["customer name", "company name", "client name", "account name", "customer", "company", "client", "account"], target: "name", confidence: "high" },
    { patterns: ["name"],                                         target: "name",             confidence: "medium" },
    { patterns: ["customer type", "type", "category"],            target: "customer_type",    confidence: "medium" },
    { patterns: ["first name", "first", "contact first"],         target: "first_name",       confidence: "high" },
    { patterns: ["last name", "last", "surname", "contact last"], target: "last_name",        confidence: "high" },
    { patterns: ["contact phone", "contactphone", "mobile", "cell"], target: "contact_phone", confidence: "medium" },
    { patterns: ["contact email", "contactemail", "contact e-mail"], target: "contact_email", confidence: "high" },
    { patterns: ["phone", "tel", "telephone"],                    target: "phone",            confidence: "high" },
    { patterns: ["email", "e-mail"],                              target: "email",            confidence: "high" },
    { patterns: ["address", "street", "address 1", "addr"],       target: "business_address", confidence: "medium" },
    { patterns: ["city", "town"],                                 target: "business_city",    confidence: "high" },
    { patterns: ["state", "province"],                            target: "business_state",   confidence: "high" },
    { patterns: ["zip", "postal", "zip code", "zipcode"],         target: "business_zip",     confidence: "high" },
    { patterns: ["billing name", "billingname", "billing/contactname", "billingcontactname"], target: "billing_name", confidence: "high" },
    { patterns: ["billing phone", "billingphone", "billing/contactphone", "billingcontactphone"], target: "billing_phone", confidence: "high" },
    { patterns: ["billing email", "billingemail", "billing/contactemail"], target: "billing_email", confidence: "high" },
    { patterns: ["billing terms", "net", "payment terms", "terms"], target: "billing_terms", confidence: "medium" },
  ],
  call_log: [
    { patterns: ["job number", "job num", "job_number", "job #"],   target: "job_number",         confidence: "high" },
    { patterns: ["display job", "display_job_number"],               target: "display_job_number", confidence: "high" },
    { patterns: ["customer name", "customer_name", "customername"],  target: "customer_name",      confidence: "high" },
    { patterns: ["project name", "project_name", "job name", "job_name"], target: "job_name",     confidence: "high" },
    { patterns: ["sales name", "sales_name", "sales rep", "sales person", "salesperson", "username"], target: "sales_name", confidence: "high" },
    { patterns: ["stage", "sales funnel", "funnel stage"],           target: "stage",              confidence: "high" },
    { patterns: ["jobsite address", "jobsite_address", "job site address", "address"], target: "jobsite_address", confidence: "high" },
    { patterns: ["jobsite city", "jobsite_city", "city"],            target: "jobsite_city",       confidence: "high" },
    { patterns: ["jobsite state", "jobsite_state", "state"],         target: "jobsite_state",      confidence: "high" },
    { patterns: ["jobsite zip", "jobsite_zip", "zip"],               target: "jobsite_zip",        confidence: "high" },
    { patterns: ["bid due", "bid_due", "bid due date"],              target: "bid_due",            confidence: "high" },
    { patterns: ["follow up", "follow_up", "follow up date"],        target: "follow_up",          confidence: "high" },
    { patterns: ["notes", "first outreach", "follow up notes"],      target: "notes",              confidence: "medium" },
    { patterns: ["work type", "work_type", "type of work"],          target: "work_type",          confidence: "high" },
    { patterns: ["created date", "created_date", "called date", "calleddate", "created_at", "date created"], target: "created_at", confidence: "high" },
    { patterns: ["customer type", "customer_type"],                  target: "customer_type",      confidence: "medium" },
    { patterns: ["prevailing wage", "prevailing_wage"],              target: "prevailing_wage",    confidence: "high" },
  ],
};

/* ── Auto-match algorithm ── */

/* Normalize a header for matching: "billing/contactName" → "billing contactname",
   "FirstName" → "first name", strip punctuation */
function normalizeHeader(h) {
  return h
    .replace(/([a-z])([A-Z])/g, "$1 $2")  // camelCase → spaces
    .replace(/[/_\-\.]+/g, " ")             // slashes, underscores, dashes, dots → spaces
    .toLowerCase()
    .trim();
}

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
    const h = normalizeHeader(header);
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
  // Try native parse — but only if it looks like a date (has digits)
  if (/\d/.test(v)) {
    const d = new Date(v);
    if (!isNaN(d.getTime()) && d.getFullYear() > 1990 && d.getFullYear() < 2100) return d.toISOString().slice(0, 10);
  }
  // Not a valid date — return null so it gets dropped from date columns
  return null;
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

/* ── Customer name classification ── */

const BUSINESS_INDICATORS = [
  "llc", "inc", "corp", "corporation", "company", "co.", "ltd", "lp",
  "construction", "plumbing", "electric", "electrical", "mechanical",
  "roofing", "painting", "flooring", "landscaping", "services", "solutions",
  "builders", "contracting", "contractors", "enterprises", "industries",
  "group", "associates", "partners", "holdings", "properties", "realty",
  "development", "design", "consulting", "management", "supply", "systems",
  "technologies", "tech", "hvac", "excavation", "excavating", "paving",
  "concrete", "masonry", "welding", "fabrication", "demolition", "hauling",
  "trucking", "disposal", "environmental", "restoration", "insulation",
  "drywall", "framing", "glazing", "steel", "iron", "fire protection",
  "sheet metal", "millwork", "cabinet",
];

/**
 * Classify a name as Business or Residential, and split residential
 * names into first/last.
 * Returns { customer_type, first_name, last_name }
 */
export function classifyCustomerName(name) {
  if (!name || !name.trim()) return { customer_type: "", first_name: "", last_name: "" };
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();

  // Check for business indicators
  const isBusiness = BUSINESS_INDICATORS.some((ind) => {
    // Match whole word or at end: "ABC Construction" but not "construct" in "John Construct"
    const regex = new RegExp(`\\b${ind.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    return regex.test(lower);
  });

  if (isBusiness) {
    return { customer_type: "Commercial", first_name: "", last_name: "" };
  }

  const words = trimmed.split(/\s+/);

  // Single word: ALL CAPS or mixed-case non-name patterns → Commercial
  // Common first names are typically Title Case and short — but acronyms (ABTC, IGT)
  // and brand names (FedEx, Subaru) are not standard first names
  if (words.length === 1) {
    const isAllCaps = trimmed === trimmed.toUpperCase() && trimmed.length >= 2;
    const hasMixedCase = /[a-z]/.test(trimmed) && /[A-Z]/.test(trimmed.slice(1)); // e.g. FedEx, BergmanKPRS
    const hasDigit = /\d/.test(trimmed);
    const hasPunctuation = /[-\/&.]/.test(trimmed);
    if (isAllCaps || hasMixedCase || hasDigit || hasPunctuation) {
      return { customer_type: "Commercial", first_name: "", last_name: "" };
    }
    // Single title-case word — likely a first name
    return { customer_type: "Residential", first_name: trimmed, last_name: "" };
  }

  // 2-3 words, no business indicators: likely "First Last"
  if (words.length >= 2 && words.length <= 3) {
    const first = words[0];
    const last = words.slice(1).join(" ");
    return { customer_type: "Residential", first_name: first, last_name: last };
  }

  // 4+ words — likely a business name
  return { customer_type: "Commercial", first_name: "", last_name: "" };
}

/**
 * Enrich a full row of mapped data for customers.
 * Auto-fills customer_type, first_name, last_name from the name field
 * when those fields aren't explicitly mapped.
 */
export function enrichCustomerRow(mappedRow, mappings) {
  const result = { ...mappedRow };
  const mappedTargets = new Set(Object.values(mappings).map(m => m.target).filter(Boolean));

  // Only enrich if name is mapped but customer_type / first_name / last_name are not
  if (result.name != null) {
    const classified = classifyCustomerName(String(result.name));
    if (!mappedTargets.has("customer_type") && classified.customer_type) {
      result.customer_type = classified.customer_type;
    }
    if (!mappedTargets.has("first_name") && classified.first_name) {
      result.first_name = classified.first_name;
    }
    if (!mappedTargets.has("last_name") && classified.last_name) {
      result.last_name = classified.last_name;
    }
  }
  return result;
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
