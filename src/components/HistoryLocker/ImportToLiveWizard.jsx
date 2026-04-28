import { useEffect, useState } from "react";
import { C, F } from "../../lib/tokens";
import { supabase } from "../../lib/supabase";
import { fetchAll } from "../../lib/supabaseHelpers";

const inputStyle = {
  padding: "10px 14px", borderRadius: 8,
  border: `1.5px solid ${C.borderStrong}`,
  background: C.linenDeep, fontSize: 14,
  color: C.textBody, fontFamily: F.ui,
  outline: "none", width: "100%",
  WebkitAppearance: "none",
};

const labelStyle = {
  fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em",
  color: C.textFaint, fontFamily: F.ui, marginBottom: 6,
};

const StepLabel = ({ n, label }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
    <div style={{ width: 26, height: 26, borderRadius: "50%", background: C.dark, border: `2px solid ${C.teal}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <span style={{ fontSize: 12, fontWeight: 900, color: C.teal, fontFamily: F.display }}>{n}</span>
    </div>
    <span style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textHead, fontFamily: F.display }}>{label}</span>
  </div>
);

const ChoiceBtn = ({ label, sub, selected, onClick }) => (
  <button onClick={onClick} style={{
    flex: 1, padding: "14px 16px", borderRadius: 10, cursor: "pointer", textAlign: "left",
    border: `2px solid ${selected ? C.teal : C.borderStrong}`,
    background: selected ? C.dark : C.linen,
    transition: "all 0.12s",
  }}>
    <div style={{ fontSize: 14, fontWeight: 800, color: selected ? C.teal : C.textHead, fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</div>
    {sub && <div style={{ fontSize: 11.5, color: selected ? "rgba(255,255,255,0.4)" : C.textFaint, fontFamily: F.ui, marginTop: 3 }}>{sub}</div>}
  </button>
);

const NavCircle = ({ onClick, disabled, children, primary }) => (
  <button onClick={onClick} disabled={disabled} style={{
    width: 48, height: 48, borderRadius: "50%", border: `2px solid ${C.teal}`,
    background: primary ? C.teal : C.dark, color: primary ? C.dark : C.teal,
    fontSize: 20, fontWeight: 900, cursor: disabled ? "default" : "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
    opacity: disabled ? 0.4 : 1, transition: "opacity 0.15s",
    fontFamily: F.display, padding: 0, lineHeight: 1,
  }}>{children}</button>
);

// Parse "7/23/2024, 11:43:00 AM" or "7/23/2024" → yyyy-mm-dd or ""
function parseDateLike(s) {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseMoney(v) {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ""));
  return isNaN(n) ? 0 : n;
}

const STEPS = [
  { key: "customerType", label: "Customer" },
  { key: "customerMatch", label: "Match or Create" },
  { key: "contact",       label: "Contact & Billing" },
  { key: "addresses",     label: "Addresses" },
  { key: "salesRep",      label: "Sales Rep" },
  { key: "workTypes",     label: "Work Types" },
  { key: "jobNumber",     label: "Job Number" },
  { key: "review",        label: "Review" },
];

export default function ImportToLiveWizard({ record, onClose, onSaved }) {
  const raw = record.raw_data || {};
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Lookups
  const [customers, setCustomers] = useState([]);
  const [team, setTeam]           = useState([]);
  const [workTypes, setWorkTypes] = useState([]);
  const [defaultTerms, setDefaultTerms] = useState(30);
  const [nextAutoJobNum, setNextAutoJobNum] = useState(null);
  const [legacyTakenBy, setLegacyTakenBy] = useState(null); // { id, display_job_number } | null

  // Parse legacy job number once (e.g., "7210" or "7210 - Foo" → 7210)
  const legacyJobNumParsed = (() => {
    const m = String(record.legacy_id || "").match(/^(\d{4,5})/);
    return m ? Number(m[1]) : null;
  })();

  // Prefill derived from archive record
  const archiveCustName = (raw["customer/customerName"] || raw["customer/ifCustomerName"] || raw["customer/Customer Name"] || record.customer_name || "").trim();
  const archiveJobName  = raw["job/Project Name"] || record.job_name || "";
  const archiveAddr     = raw["address/Address"] || "";
  const archiveCity     = raw["address/City"] || "";
  const archiveState    = raw["address/State"] || "";
  const archiveZip      = raw["address/Zip"] || "";
  const archiveTypeOfWork = raw["job/Type of Work"] || "";
  const archiveRepEmail = raw["job/salesPerson_email"] || "";
  const archiveBidDue   = parseDateLike(raw["job/Bid Due Date"]);
  const archiveSoldAmt  = parseMoney(raw["job/soldAmount"] || raw["job/proposalAmount"] || record.amount);
  const archivePhone    = raw["customer/Phone number"] || "";

  const [form, setForm] = useState({
    customerType: null,       // "Residential" | "Commercial"
    customerMode: "existing", // "existing" | "new"
    customerId: "",

    // new-customer fields
    firstName: "",
    lastName: "",
    businessName: archiveCustName,

    // contact
    contactName: "",
    contactPhone: archivePhone,
    contactEmail: "",
    billingName: "",    // REQUIRED
    billingEmail: "",   // REQUIRED
    billingPhone: "",
    billingTerms: "30",

    // addresses — jobsite prefilled, business blank
    jobsiteAddress: archiveAddr, jobsiteCity: archiveCity, jobsiteState: archiveState, jobsiteZip: archiveZip,
    businessAddress: "", businessCity: "", businessState: "", businessZip: "",
    billingSame: true,

    // sales rep + work types
    salesName: "",
    selectedWorkTypeIds: [],

    // job
    projectName: archiveJobName,
    bidDue: archiveBidDue,
    soldAmount: String(archiveSoldAmt || ""),

    // job number
    useLegacyJobNum: true,
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Load lookups
  useEffect(() => {
    (async () => {
      const [cAll, tRes, wRes, tcRes, lastJobRes, legacyCheckRes] = await Promise.all([
        fetchAll("customers", "id, name, customer_type, first_name, last_name, phone, email, contact_phone, contact_email, business_address, business_city, business_state, business_zip, billing_terms, billing_name, billing_email, billing_phone", { order: "name" }),
        supabase.from("team_members").select("id, name, email, role").eq("active", true),
        supabase.from("work_types").select("id, name, cost_code").order("name"),
        supabase.from("tenant_config").select("default_billing_terms").limit(1).maybeSingle(),
        supabase.from("call_log").select("job_number").order("job_number", { ascending: false }).limit(1),
        legacyJobNumParsed
          ? supabase.from("call_log").select("id, display_job_number").eq("job_number", legacyJobNumParsed).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      setCustomers(cAll || []);
      setTeam(tRes.data || []);
      setWorkTypes(wRes.data || []);
      if (tcRes.data?.default_billing_terms) setDefaultTerms(tcRes.data.default_billing_terms);
      const lastNum = lastJobRes.data?.[0]?.job_number;
      setNextAutoJobNum(lastNum ? lastNum + 1 : 10000);
      if (legacyCheckRes.data) {
        setLegacyTakenBy(legacyCheckRes.data);
        setForm(f => ({ ...f, useLegacyJobNum: false }));
      } else if (!legacyJobNumParsed) {
        setForm(f => ({ ...f, useLegacyJobNum: false }));
      }
    })();
  }, []);

  // Auto-match existing customer by name (case-insensitive exact)
  useEffect(() => {
    if (!customers.length || !archiveCustName) return;
    const match = customers.find(c => (c.name || "").trim().toLowerCase() === archiveCustName.toLowerCase());
    if (match) {
      setForm(f => ({
        ...f,
        customerMode: "existing",
        customerId: match.id,
        customerType: match.customer_type || f.customerType,
        contactPhone: match.contact_phone || match.phone || f.contactPhone,
        contactEmail: match.contact_email || match.email || f.contactEmail,
        billingName:  match.billing_name  || f.billingName,
        billingEmail: match.billing_email || f.billingEmail,
        billingPhone: match.billing_phone || f.billingPhone,
        billingTerms: match.billing_terms ? String(match.billing_terms) : f.billingTerms,
        businessAddress: match.business_address || f.businessAddress,
        businessCity:    match.business_city    || f.businessCity,
        businessState:   match.business_state   || f.businessState,
        businessZip:     match.business_zip     || f.businessZip,
      }));
    } else {
      // No match → prefill "new" with archive data
      setForm(f => ({ ...f, customerMode: "new", customerId: "", businessName: archiveCustName }));
    }
  }, [customers, archiveCustName]);

  // Auto-match sales rep by email
  useEffect(() => {
    if (!team.length || !archiveRepEmail) return;
    const match = team.find(t => (t.email || "").toLowerCase() === archiveRepEmail.toLowerCase());
    if (match && !form.salesName) set("salesName", match.name);
  }, [team, archiveRepEmail]);

  // Auto-match work type (first fuzzy hit)
  useEffect(() => {
    if (!workTypes.length || !archiveTypeOfWork || form.selectedWorkTypeIds.length) return;
    const q = archiveTypeOfWork.toLowerCase();
    const qTokens = q.split(/\s+/).filter(Boolean);
    // try exact, then includes, then token-overlap
    let best = workTypes.find(w => (w.name || "").toLowerCase() === q);
    if (!best) best = workTypes.find(w => (w.name || "").toLowerCase().includes(q) || q.includes((w.name || "").toLowerCase()));
    if (!best) {
      let bestScore = 0;
      for (const w of workTypes) {
        const tokens = (w.name || "").toLowerCase().split(/\s+/);
        const score = tokens.filter(t => qTokens.includes(t)).length;
        if (score > bestScore) { bestScore = score; best = w; }
      }
      if (bestScore === 0) best = null;
    }
    if (best) set("selectedWorkTypeIds", [best.id]);
  }, [workTypes, archiveTypeOfWork]);

  // Default billing terms on first lookup load
  useEffect(() => {
    if (defaultTerms && form.billingTerms === "30") set("billingTerms", String(defaultTerms));
  }, [defaultTerms]);

  const currentKey = STEPS[step].key;
  const isLast = currentKey === "review";

  const validate = () => {
    setError(null);
    switch (currentKey) {
      case "customerType":
        if (!form.customerType) { setError("Select a customer type"); return false; }
        return true;
      case "customerMatch":
        if (form.customerMode === "existing" && !form.customerId) { setError("Select a customer or switch to Create New"); return false; }
        if (form.customerMode === "new") {
          if (form.customerType === "Residential" && (!form.firstName.trim() || !form.lastName.trim())) { setError("First and last name required"); return false; }
          if (form.customerType === "Commercial" && !form.businessName.trim()) { setError("Business name required"); return false; }
        }
        return true;
      case "contact":
        if (!form.billingName.trim())  { setError("Billing contact name is required"); return false; }
        if (!form.billingEmail.trim()) { setError("Billing contact email is required"); return false; }
        return true;
      case "addresses":
        if (!form.businessAddress.trim() || !form.businessCity.trim() || !form.businessState.trim() || !form.businessZip.trim()) {
          setError(`${form.customerType === "Residential" ? "Customer" : "Business"} address is required`);
          return false;
        }
        return true;
      case "salesRep":
        if (!form.salesName) { setError("Select a sales rep"); return false; }
        return true;
      case "workTypes":
        if (!form.selectedWorkTypeIds.length) { setError("Select at least one work type"); return false; }
        return true;
      case "jobNumber":
        if (form.useLegacyJobNum && (!legacyJobNumParsed || legacyTakenBy)) {
          setError("Legacy number unavailable — pick Assign New");
          return false;
        }
        return true;
      default:
        return true;
    }
  };

  const handleNext = () => {
    if (!validate()) return;
    if (isLast) { handleImport(); return; }
    setStep(s => s + 1);
  };

  const matchedCustomer = form.customerId ? customers.find(c => c.id === form.customerId) : null;
  const matchedRepEmailOK = team.find(t => t.name === form.salesName)?.email?.toLowerCase() === archiveRepEmail.toLowerCase();

  const custName = () => {
    if (form.customerMode === "existing") return matchedCustomer?.name || "";
    if (form.customerType === "Residential") return `${form.firstName} ${form.lastName}`.trim();
    return form.businessName.trim();
  };

  async function handleImport() {
    setSaving(true);
    setError(null);
    try {
      // 1. Customer
      let customerId = form.customerMode === "existing" ? form.customerId : null;
      if (form.customerMode === "new") {
        const name = custName();
        const billingTermsNum = parseInt(form.billingTerms) || 30;
        const { data: newC, error: cErr } = await supabase.from("customers").insert([{
          name,
          customer_type: form.customerType,
          first_name: form.customerType === "Residential" ? form.firstName : null,
          last_name:  form.customerType === "Residential" ? form.lastName  : null,
          phone: form.contactPhone || null,
          email: form.contactEmail || null,
          contact_phone: form.contactPhone || null,
          contact_email: form.contactEmail || null,
          billing_name:  form.billingName,
          billing_email: form.billingEmail,
          billing_phone: form.billingPhone || null,
          billing_same:  !form.billingName, // if billing contact provided, not same
          billing_terms: billingTermsNum,
          business_address: form.businessAddress,
          business_city:    form.businessCity,
          business_state:   form.businessState,
          business_zip:     form.businessZip,
        }]).select().single();
        if (cErr) throw new Error("Customer: " + cErr.message);
        customerId = newC.id;
      }

      // 2. Job number — legacy if user picked it (re-check availability), else next auto
      let jobNum;
      if (form.useLegacyJobNum && legacyJobNumParsed) {
        const { data: stillTaken } = await supabase.from("call_log")
          .select("id, display_job_number")
          .eq("job_number", legacyJobNumParsed)
          .maybeSingle();
        if (stillTaken) {
          throw new Error(`Legacy number ${legacyJobNumParsed} is now in use on Job #${stillTaken.display_job_number || stillTaken.id}. Go back and choose Assign New.`);
        }
        jobNum = legacyJobNumParsed;
      } else {
        const { data: lastJob } = await supabase.from("call_log").select("job_number").order("job_number", { ascending: false }).limit(1);
        jobNum = lastJob && lastJob.length ? (lastJob[0].job_number || 9999) + 1 : 10000;
      }
      const displayLabel = form.projectName || custName();
      const displayJobNum = `${jobNum} - ${displayLabel}`;

      // 3. call_log
      const jobsiteSet = form.jobsiteAddress || form.jobsiteCity;
      const { data: newJob, error: jErr } = await supabase.from("call_log").insert([{
        job_number: jobNum,
        display_job_number: displayJobNum,
        job_name: form.projectName || null,
        customer_name: custName(),
        customer_type: form.customerType,
        customer_id: customerId,
        sales_name: form.salesName,
        stage: "Sold",
        bid_due: form.bidDue || null,
        is_change_order: false,
        jobsite_address: jobsiteSet ? form.jobsiteAddress : null,
        jobsite_city:    jobsiteSet ? form.jobsiteCity    : null,
        jobsite_state:   jobsiteSet ? form.jobsiteState   : null,
        jobsite_zip:     jobsiteSet ? form.jobsiteZip     : null,
        billing_address: form.billingSame ? form.businessAddress : null,
        billing_city:    form.billingSame ? form.businessCity    : null,
        billing_state:   form.billingSame ? form.businessState   : null,
        billing_zip:     form.billingSame ? form.businessZip     : null,
        billing_address_same: form.billingSame,
        archive_record_id: record.id,
        qb_skip_sync: true,
      }]).select().single();
      if (jErr) throw new Error("Call log: " + jErr.message);

      // 4. job_work_types
      if (form.selectedWorkTypeIds.length) {
        const { error: wErr } = await supabase.from("job_work_types").insert(
          form.selectedWorkTypeIds.map(id => ({ call_log_id: newJob.id, work_type_id: id }))
        );
        if (wErr) console.error("job_work_types insert failed:", wErr.message);
      }

      setSaving(false);
      onSaved?.({ jobId: newJob.id });
    } catch (e) {
      setSaving(false);
      setError(e.message || "Import failed");
    }
  }

  const renderStep = () => {
    switch (currentKey) {

      case "customerType": return (
        <div>
          <StepLabel n={1} label="Customer Type" />
          <div style={{ display: "flex", gap: 10 }}>
            <ChoiceBtn label="Commercial" sub="Business name" selected={form.customerType === "Commercial"} onClick={() => set("customerType", "Commercial")} />
            <ChoiceBtn label="Residential" sub="First & last name" selected={form.customerType === "Residential"} onClick={() => set("customerType", "Residential")} />
          </div>
          {archiveCustName && (
            <div style={{ marginTop: 16, fontSize: 12, color: C.textFaint, fontFamily: F.ui }}>
              Archive name: <span style={{ color: C.textBody, fontWeight: 700 }}>{archiveCustName}</span>
            </div>
          )}
        </div>
      );

      case "customerMatch": {
        const filtered = customers.filter(c => c.customer_type === form.customerType);
        return (
          <div>
            <StepLabel n={2} label="Match or Create Customer" />
            {matchedCustomer && form.customerMode === "existing" && (
              <div style={{ padding: 12, background: C.dark, borderRadius: 8, border: `1px solid ${C.tealBorder}`, marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.12em", fontFamily: F.ui, textTransform: "uppercase" }}>Matched Customer</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.teal, fontFamily: F.display, marginTop: 4 }}>{matchedCustomer.name}</div>
              </div>
            )}
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <ChoiceBtn label="Use Existing" selected={form.customerMode === "existing"} onClick={() => set("customerMode", "existing")} />
              <ChoiceBtn label="Create New" selected={form.customerMode === "new"} onClick={() => set("customerMode", "new")} />
            </div>
            {form.customerMode === "existing" && (
              <select value={form.customerId} onChange={e => {
                const id = e.target.value;
                set("customerId", id);
                const c = customers.find(x => x.id === id);
                if (c) {
                  setForm(f => ({ ...f,
                    customerId: id,
                    contactPhone: c.contact_phone || c.phone || f.contactPhone,
                    contactEmail: c.contact_email || c.email || f.contactEmail,
                    billingName:  c.billing_name  || f.billingName,
                    billingEmail: c.billing_email || f.billingEmail,
                    billingPhone: c.billing_phone || f.billingPhone,
                    billingTerms: c.billing_terms ? String(c.billing_terms) : f.billingTerms,
                    businessAddress: c.business_address || f.businessAddress,
                    businessCity:    c.business_city    || f.businessCity,
                    businessState:   c.business_state   || f.businessState,
                    businessZip:     c.business_zip     || f.businessZip,
                  }));
                }
              }} style={inputStyle}>
                <option value="">— Select Customer —</option>
                {filtered.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            {form.customerMode === "new" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {form.customerType === "Residential" ? (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <input placeholder="First Name" value={form.firstName} onChange={e => set("firstName", e.target.value)} style={inputStyle} />
                    <input placeholder="Last Name"  value={form.lastName}  onChange={e => set("lastName",  e.target.value)} style={inputStyle} />
                  </div>
                ) : (
                  <input placeholder="Business Name" value={form.businessName} onChange={e => set("businessName", e.target.value)} style={inputStyle} />
                )}
                <div style={{ fontSize: 11.5, color: C.textFaint, fontFamily: F.ui }}>
                  Prefilled from archive: <span style={{ color: C.textBody, fontWeight: 600 }}>{archiveCustName || "—"}</span>
                </div>
              </div>
            )}
          </div>
        );
      }

      case "contact": return (
        <div>
          <StepLabel n={3} label="Contact & Billing" />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input placeholder="Contact Name (optional)" value={form.contactName} onChange={e => set("contactName", e.target.value)} style={inputStyle} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <input placeholder="Phone" value={form.contactPhone} onChange={e => set("contactPhone", e.target.value)} style={inputStyle} />
              <input placeholder="Email" value={form.contactEmail} onChange={e => set("contactEmail", e.target.value)} style={inputStyle} />
            </div>

            <div style={{ marginTop: 10, padding: "12px 14px", background: C.linen, borderRadius: 8, border: `1px solid ${C.border}` }}>
              <div style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6 }}>
                Billing Contact
                <span style={{ fontSize: 10, color: C.teal, background: C.dark, padding: "1px 6px", borderRadius: 4, letterSpacing: "0.08em" }}>REQUIRED</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <input placeholder="Billing Contact Name" value={form.billingName} onChange={e => set("billingName", e.target.value)} style={inputStyle} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <input placeholder="Billing Phone" value={form.billingPhone} onChange={e => set("billingPhone", e.target.value)} style={inputStyle} />
                  <input placeholder="Billing Email" value={form.billingEmail} onChange={e => set("billingEmail", e.target.value)} style={inputStyle} />
                </div>
              </div>
            </div>

            <div style={{ marginTop: 6 }}>
              <div style={labelStyle}>Billing Terms</div>
              <select value={form.billingTerms} onChange={e => set("billingTerms", e.target.value)} style={inputStyle}>
                <option value="5">Net 5</option>
                <option value="15">Net 15</option>
                <option value="30">Net 30</option>
                <option value="45">Net 45</option>
                <option value="60">Net 60</option>
                <option value="90">Net 90</option>
                <option value="120">Net 120</option>
              </select>
            </div>
          </div>
        </div>
      );

      case "addresses": return (
        <div>
          <StepLabel n={4} label="Addresses" />
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ padding: 14, background: C.linen, borderRadius: 10, border: `1.5px solid ${C.borderStrong}` }}>
              <div style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                {form.customerType === "Residential" ? "Customer Address" : "Business Address"}
                <span style={{ fontSize: 10, color: C.teal, background: C.dark, padding: "1px 6px", borderRadius: 4, letterSpacing: "0.08em" }}>REQUIRED</span>
              </div>
              <input placeholder="Street" value={form.businessAddress} onChange={e => set("businessAddress", e.target.value)} style={{ ...inputStyle, marginBottom: 8 }} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 100px", gap: 8 }}>
                <input placeholder="City"  value={form.businessCity}  onChange={e => set("businessCity",  e.target.value)} style={inputStyle} />
                <input placeholder="State" value={form.businessState} onChange={e => set("businessState", e.target.value)} style={inputStyle} maxLength={2} />
                <input placeholder="Zip"   value={form.businessZip}   onChange={e => set("businessZip",   e.target.value)} style={inputStyle} />
              </div>
              <div style={{ fontSize: 11.5, color: C.textFaint, fontFamily: F.ui, marginTop: 8 }}>
                Archive doesn't include a {form.customerType === "Residential" ? "customer" : "business"} address — please enter it from the signed contract.
              </div>
            </div>

            <div style={{ padding: 14, background: C.linen, borderRadius: 10, border: `1.5px solid ${C.borderStrong}` }}>
              <div style={{ ...labelStyle, marginBottom: 10 }}>Jobsite Address <span style={{ fontSize: 10, color: C.textFaint, background: C.linenLight, padding: "1px 6px", borderRadius: 4, border: `1px solid ${C.border}`, marginLeft: 6 }}>FROM ARCHIVE</span></div>
              <input placeholder="Street" value={form.jobsiteAddress} onChange={e => set("jobsiteAddress", e.target.value)} style={{ ...inputStyle, marginBottom: 8 }} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 100px", gap: 8 }}>
                <input placeholder="City"  value={form.jobsiteCity}  onChange={e => set("jobsiteCity",  e.target.value)} style={inputStyle} />
                <input placeholder="State" value={form.jobsiteState} onChange={e => set("jobsiteState", e.target.value)} style={inputStyle} maxLength={2} />
                <input placeholder="Zip"   value={form.jobsiteZip}   onChange={e => set("jobsiteZip",   e.target.value)} style={inputStyle} />
              </div>
            </div>
          </div>
        </div>
      );

      case "salesRep": return (
        <div>
          <StepLabel n={5} label="Sales Rep" />
          {archiveRepEmail && matchedRepEmailOK && (
            <div style={{ padding: 12, background: C.dark, borderRadius: 8, border: `1px solid ${C.tealBorder}`, marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.12em", fontFamily: F.ui, textTransform: "uppercase" }}>Matched from Archive Email</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: C.teal, fontFamily: F.display, marginTop: 4 }}>{form.salesName}</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontFamily: F.ui, marginTop: 2 }}>{archiveRepEmail}</div>
            </div>
          )}
          {archiveRepEmail && !matchedRepEmailOK && (
            <div style={{ padding: 10, background: "rgba(230,168,0,0.08)", borderRadius: 7, border: "1px solid rgba(230,168,0,0.25)", marginBottom: 14, fontSize: 12, color: "#a07800", fontFamily: F.ui, fontWeight: 600 }}>
              No team member match for archive email {archiveRepEmail} — pick one.
            </div>
          )}
          <select value={form.salesName} onChange={e => set("salesName", e.target.value)} style={inputStyle}>
            <option value="">— Select Sales Rep —</option>
            {team.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
        </div>
      );

      case "workTypes": return (
        <div>
          <StepLabel n={6} label="Work Types" />
          {archiveTypeOfWork && (
            <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui, marginBottom: 10 }}>
              Archive: <span style={{ color: C.textBody, fontWeight: 700 }}>{archiveTypeOfWork}</span>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 300, overflowY: "auto", paddingRight: 4 }}>
            {workTypes.map(wt => {
              const sel = form.selectedWorkTypeIds.includes(wt.id);
              return (
                <button key={wt.id} onClick={() => set("selectedWorkTypeIds", sel ? form.selectedWorkTypeIds.filter(x => x !== wt.id) : [...form.selectedWorkTypeIds, wt.id])}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, border: `1.5px solid ${sel ? C.teal : C.border}`, background: sel ? C.dark : C.linen, cursor: "pointer", textAlign: "left" }}>
                  <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${sel ? C.teal : C.borderStrong}`, background: sel ? C.teal : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {sel && <span style={{ color: C.dark, fontSize: 10, fontWeight: 900 }}>✓</span>}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: sel ? 700 : 400, color: sel ? C.teal : C.textBody, fontFamily: F.ui }}>{wt.name}</span>
                  <span style={{ fontSize: 11, color: sel ? "rgba(255,255,255,0.35)" : C.textFaint, fontFamily: F.ui, marginLeft: "auto" }}>{wt.cost_code}</span>
                </button>
              );
            })}
          </div>
        </div>
      );

      case "jobNumber": {
        const legacyDisabled = !legacyJobNumParsed || !!legacyTakenBy;
        const Radio = ({ selected, disabled, onClick, primary, sub, hint }) => (
          <div
            onClick={disabled ? undefined : onClick}
            style={{
              display: "flex", gap: 12, alignItems: "flex-start",
              padding: "14px 16px", marginBottom: 10,
              background: selected ? C.dark : C.linenDeep,
              border: `1.5px solid ${selected ? C.teal : C.border}`,
              borderRadius: 10,
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.55 : 1,
            }}
          >
            <div style={{
              width: 18, height: 18, borderRadius: "50%",
              border: `2px solid ${selected ? C.teal : C.border}`,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1,
            }}>
              {selected && <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.teal }} />}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: selected ? C.teal : C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>{primary}</div>
              {sub && <div style={{ fontSize: 12, color: selected ? "rgba(48,207,172,0.85)" : C.textBody, fontFamily: F.ui, marginTop: 2 }}>{sub}</div>}
              {hint && <div style={{ fontSize: 11, color: selected ? "rgba(255,255,255,0.55)" : C.textFaint, fontFamily: F.ui, marginTop: 4 }}>{hint}</div>}
            </div>
          </div>
        );
        return (
          <div>
            <StepLabel n={7} label="Job Number" />
            <Radio
              selected={form.useLegacyJobNum}
              disabled={legacyDisabled}
              onClick={() => set("useLegacyJobNum", true)}
              primary={legacyJobNumParsed ? `Keep legacy number: ${legacyJobNumParsed}` : "No legacy number to keep"}
              sub={!legacyJobNumParsed ? `Couldn't parse a number from "${record.legacy_id || "—"}"` : null}
              hint={legacyTakenBy ? `Already in use on Job #${legacyTakenBy.display_job_number || legacyTakenBy.id}` : null}
            />
            <Radio
              selected={!form.useLegacyJobNum}
              onClick={() => set("useLegacyJobNum", false)}
              primary={`Assign new number: ${nextAutoJobNum ?? "…"}`}
              sub="Next auto-incremented job number"
            />
          </div>
        );
      }

      case "review": {
        const sumRow = (label, val) => (
          <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10, padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textFaint, fontFamily: F.display }}>{label}</span>
            <span style={{ fontSize: 13, color: C.textBody, fontFamily: F.ui }}>{val || "—"}</span>
          </div>
        );
        const wtNames = form.selectedWorkTypeIds.map(id => workTypes.find(w => w.id === id)?.name).filter(Boolean).join(", ");
        const chosenJobNum = form.useLegacyJobNum && legacyJobNumParsed ? legacyJobNumParsed : nextAutoJobNum;
        return (
          <div>
            <StepLabel n={8} label="Review" />
            <div style={{ padding: 14, background: C.linenCard, borderRadius: 10, border: `1px solid ${C.borderStrong}` }}>
              {sumRow("Customer",     `${custName()} (${form.customerMode === "existing" ? "existing" : "new"})`)}
              {sumRow("Type",         form.customerType)}
              {sumRow("Billing",      `${form.billingName} · ${form.billingEmail}`)}
              {sumRow("Jobsite",      [form.jobsiteAddress, [form.jobsiteCity, form.jobsiteState, form.jobsiteZip].filter(Boolean).join(" ")].filter(Boolean).join(", "))}
              {sumRow("Business",     [form.businessAddress, [form.businessCity, form.businessState, form.businessZip].filter(Boolean).join(" ")].filter(Boolean).join(", "))}
              {sumRow("Sales Rep",    form.salesName)}
              {sumRow("Work Types",   wtNames)}
              {sumRow("Project",      form.projectName)}
              {sumRow("Sold Amount",  form.soldAmount ? `$${Number(form.soldAmount).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—")}
              {sumRow("Job Number",   chosenJobNum ? `${chosenJobNum}${form.useLegacyJobNum ? " (legacy)" : " (new)"}` : "—")}
              {sumRow("Archive ID",   record.legacy_id)}
            </div>
            <div style={{ fontSize: 11.5, color: C.textFaint, fontFamily: F.ui, marginTop: 12, lineHeight: 1.5 }}>
              On import: creates a live call_log (stage = Sold) linked to this archive record. No proposal is created — build one from the job's detail page when you're ready to invoice.
              Attachments stay in archive storage — no files are copied.
            </div>
          </div>
        );
      }

      default: return null;
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(28,24,20,0.65)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "fixed", top: "50%", left: "calc(50% - 364px)", transform: "translateY(-50%)", zIndex: 101 }}>
        {step > 0 ? <NavCircle onClick={() => setStep(s => s - 1)}>←</NavCircle> : <div style={{ width: 48 }} />}
      </div>
      <div style={{ position: "fixed", top: "50%", right: "calc(50% - 364px)", transform: "translateY(-50%)", zIndex: 101 }}>
        <NavCircle onClick={handleNext} disabled={saving} primary>{isLast ? "✓" : "→"}</NavCircle>
      </div>
      <div style={{ background: C.linenCard, borderRadius: 14, padding: 32, width: 620, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.45)", border: `1px solid ${C.borderStrong}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            Import to Live · <span style={{ color: C.teal }}>{record.legacy_id}</span>
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: C.textFaint }}>✕</button>
        </div>
        <div style={{ background: C.dark, borderRadius: 9, padding: "10px 16px", marginBottom: 20, border: `1px solid ${C.tealBorder}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(255,255,255,0.3)", fontFamily: F.ui, marginBottom: 3 }}>Archive Record</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.teal, fontFamily: F.display, letterSpacing: "0.04em" }}>{record.job_name || archiveCustName || "—"}</div>
        </div>
        {renderStep()}
        {error && <div style={{ color: C.red, fontSize: 13, fontFamily: F.ui, marginTop: 12, textAlign: "center" }}>{error}</div>}
        <div style={{ fontSize: 11, fontWeight: 700, color: C.textFaint, fontFamily: F.ui, letterSpacing: "0.08em", textTransform: "uppercase", textAlign: "center", marginTop: 16 }}>
          {step + 1} / {STEPS.length} · {STEPS[step].label}
        </div>
      </div>
    </div>
  );
}
