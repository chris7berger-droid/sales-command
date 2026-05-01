import { useEffect, useState, useRef } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import { STAGES } from "../lib/mockData";
import Btn from "./Btn";
import SearchSelect from "./SearchSelect";
import ContactBillingPicker from "./ContactBillingPicker";

const inputStyle = {
  padding: "10px 14px", borderRadius: 8,
  border: `1.5px solid ${C.borderStrong}`,
  background: C.linenDeep, fontSize: 14,
  color: C.textBody, fontFamily: F.ui,
  outline: "none", width: "100%",
  WebkitAppearance: "none",
};

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

const StepLabel = ({ n, label }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
    <div style={{ width: 26, height: 26, borderRadius: "50%", background: C.dark, border: `2px solid ${C.teal}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <span style={{ fontSize: 12, fontWeight: 900, color: C.teal, fontFamily: F.display }}>{n}</span>
    </div>
    <span style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textHead, fontFamily: F.display }}>{label}</span>
  </div>
);

const AddressBlock = ({ label, required, fields, set, sectionKey }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.ui, display: "flex", alignItems: "center", gap: 6 }}>
      {label}
      {required && <span style={{ fontSize: 10, color: C.teal, background: C.dark, padding: "1px 6px", borderRadius: 4, letterSpacing: "0.08em" }}>REQUIRED</span>}
      {!required && label && <span style={{ fontSize: 10, color: C.textFaint, background: C.linen, padding: "1px 6px", borderRadius: 4, border: `1px solid ${C.border}`, letterSpacing: "0.08em" }}>OPTIONAL</span>}
    </div>
    <input placeholder="Street Address" value={fields.address} onChange={e => set(sectionKey + "Address", e.target.value)} style={inputStyle} />
    <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 100px", gap: 10 }}>
      <input placeholder="City" value={fields.city} onChange={e => set(sectionKey + "City", e.target.value)} style={inputStyle} />
      <input placeholder="State" value={fields.state} onChange={e => set(sectionKey + "State", e.target.value)} style={inputStyle} maxLength={2} />
      <input placeholder="Zip" value={fields.zip} onChange={e => set(sectionKey + "Zip", e.target.value)} style={inputStyle} />
    </div>
  </div>
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

function buildStepList(jobType) {
  const steps = ["jobType"];
  if (jobType === "override") steps.push("manualNum");
  if (jobType === "co") { steps.push("parentJob"); steps.push("coTreatment"); }
  steps.push("customerType");
  steps.push("customerSelect");
  steps.push("projectName");
  steps.push("contactInfo");
  steps.push("addresses");
  steps.push("salesRep");
  steps.push("workTypes");
  steps.push("bidDue");
  steps.push("followUp");
  steps.push("notes");
  return steps;
}

function NewInquiryWizard({ onClose, onSaved, team, customers, allJobs, workTypes, initialJobType = null, initialParentJobId = null }) {
  const preset = initialJobType === "co" && initialParentJobId;
  const [step, setStep] = useState(preset ? 2 : 0);
  const [saving, setSaving] = useState(false);
  const [wtSearch, setWtSearch] = useState("");
  const [error, setError] = useState(null);
  const [nextJobNum, setNextJobNum] = useState(null);
  const fileRef = useRef();

  useEffect(() => {
    supabase.from("call_log").select("job_number").order("job_number", { ascending: false }).limit(1)
      .then(({ data: last }) => {
        setNextJobNum(last && last.length > 0 ? (last[0].job_number || 9999) + 1 : 10000);
      });
  }, []);

  const [data, setData] = useState({
    jobType: initialJobType,
    manualJobNum: "",
    parentJobId: initialParentJobId ? String(initialParentJobId) : "",
    coStandalone: false,
    customerType: null,
    customerMode: null,
    customerId: "",
    firstName: "",
    lastName: "",
    businessName: "",
    projectName: "",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    billingSame: true,
    billingName: "",
    billingPhone: "",
    billingEmail: "",
    billingTerms: "30",
    billingTermsCustom: "",
    billingSourceContactId: null,
    businessAddress: "", businessCity: "", businessState: "", businessZip: "",
    jobsiteAddress: "", jobsiteCity: "", jobsiteState: "", jobsiteZip: "", newSiteBuild: false, jobsiteSame: false,
    billingAddressSame: true,
    billingAddrStreet: "", billingAddrCity: "", billingAddrState: "", billingAddrZip: "",
    salesName: "",
    stage: "New Inquiry",
    selectedWorkTypes: [],
    bidDue: "",
    wantFollowUp: false,
    followUp: "",
    notes: "",
    attachments: [],
    additionalContacts: [],
  });

  const set = (k, v) => setData(d => ({ ...d, [k]: v }));
  const stepList = buildStepList(data.jobType);
  const currentKey = stepList[step];
  const next = () => { setError(null); setStep(s => s + 1); };
  const back = () => { setError(null); setStep(s => s - 1); };

  const validateStep = () => {
    setError(null);
    switch (currentKey) {
      case "jobType": if (!data.jobType) { setError("Select a job type"); return false; } return true;
      case "manualNum": if (!data.manualJobNum) { setError("Job number required"); return false; } return true;
      case "parentJob": if (!data.parentJobId) { setError("Select a parent job"); return false; } return true;
      case "customerSelect":
        if (!data.customerMode) { setError("Select an option"); return false; }
        if (data.customerMode === "existing" && !data.customerId) { setError("Select a customer"); return false; }
        if (data.customerMode === "new") {
          if (data.customerType === "Residential" && (!data.firstName || !data.lastName)) { setError("First and last name required"); return false; }
          if (data.customerType === "Commercial" && !data.businessName) { setError("Business name required"); return false; }
        }
        return true;
      case "contactInfo":
        if (!data.billingTerms) { setError("Billing terms are required"); return false; }
        if (data.billingTerms === "custom" && !data.billingTermsCustom) { setError("Enter custom billing terms (days)"); return false; }
        return true;
      case "addresses":
        if (!data.businessAddress || !data.businessCity || !data.businessState || !data.businessZip) {
          setError(`${data.customerType === "Residential" ? "Customer" : "Business"} address is required (street, city, state, zip)`);
          return false;
        }
        return true;
      case "salesRep": if (!data.salesName) { setError("Select a sales rep"); return false; } return true;
      case "workTypes": if (data.selectedWorkTypes.length === 0) { setError("Select at least one work type"); return false; } setWtSearch(""); return true;
      case "bidDue": if (!data.bidDue) { setError("Bid due date is required"); return false; } return true;
      default: return true;
    }
  };

  const isLastStep = currentKey === "notes";
  const handleNext = () => {
    if (!validateStep()) return;
    if (isLastStep) { save(); return; }
    next();
  };

  const custName = () => {
    if (data.customerMode === "existing") return customers.find(c => c.id === data.customerId)?.name || "";
    if (data.customerType === "Residential") return `${data.firstName} ${data.lastName}`.trim();
    return data.businessName.trim();
  };

  const previewNum = data.jobType === "override" && data.manualJobNum ? data.manualJobNum : (nextJobNum || "####");
  const previewCO = data.jobType === "co" && data.parentJobId ? " CO#" : "";
  const previewName = data.projectName || custName() || "Customer";
  const previewDisplay = `${previewNum}${previewCO} - ${previewName}`;

  const uploadFiles = async (jobId) => {
    const failures = [];
    for (const file of data.attachments) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${jobId}/${Date.now()}-${safeName}`;
      const { error: upErr } = await supabase.storage.from("job-attachments").upload(path, file);
      if (upErr) failures.push(file.name);
    }
    if (failures.length) alert(`Failed to upload: ${failures.join(", ")}`);
  };

  const save = async () => {
    setSaving(true);
    const name = custName();

    let jobNum;
    if (data.jobType === "override" && data.manualJobNum) {
      jobNum = parseInt(data.manualJobNum);
    } else {
      const { data: last } = await supabase.from("call_log").select("job_number").order("job_number", { ascending: false }).limit(1);
      jobNum = last && last.length > 0 ? (last[0].job_number || 9999) + 1 : 10000;
    }

    let coNum = null;
    if (data.jobType === "co" && data.parentJobId) {
      const { data: cos } = await supabase.from("call_log").select("co_number").eq("parent_job_id", data.parentJobId).order("co_number", { ascending: false }).limit(1);
      coNum = cos && cos.length > 0 ? (cos[0].co_number || 0) + 1 : 1;
    }

    const displayLabel = data.projectName || name;
    const displayJobNum = data.jobType === "co" && coNum
      ? `${jobNum} CO${coNum} - ${displayLabel}`
      : `${jobNum} - ${displayLabel}`;

    const billingAddrStreet = data.billingAddressSame ? data.businessAddress : data.billingAddrStreet;
    const billingAddrCity   = data.billingAddressSame ? data.businessCity    : data.billingAddrCity;
    const billingAddrState  = data.billingAddressSame ? data.businessState   : data.billingAddrState;
    const billingAddrZip    = data.billingAddressSame ? data.businessZip     : data.billingAddrZip;

    let customerId = data.customerId || null;
    const billingTermsNum = data.billingTerms === "custom" ? (parseInt(data.billingTermsCustom) || 30) : (parseInt(data.billingTerms) || 30);
    // Update existing customer's contact info; skip billing_* writes when picker locked them from a customer_contacts Billing Contact row.
    if (data.customerMode === "existing" && customerId) {
      const update = {
        phone: data.contactPhone || null,
        email: data.contactEmail || null,
        contact_email: data.contactEmail || null,
        contact_phone: data.contactPhone || null,
        billing_terms: billingTermsNum,
      };
      if (!data.billingSourceContactId) {
        update.billing_same = data.billingSame;
        update.billing_name = data.billingSame ? null : data.billingName;
        update.billing_phone = data.billingSame ? null : data.billingPhone;
        update.billing_email = data.billingSame ? null : data.billingEmail;
      }
      await supabase.from("customers").update(update).eq("id", customerId);
    }
    if (data.customerMode === "new") {
      const { data: nc, error: custErr } = await supabase.from("customers").insert([{
        name, customer_type: data.customerType,
        first_name: data.firstName, last_name: data.lastName,
        phone: data.contactPhone, email: data.contactEmail,
        contact_phone: data.contactPhone, contact_email: data.contactEmail,
        billing_same: data.billingSame,
        billing_name: data.billingSame ? null : data.billingName,
        billing_phone: data.billingSame ? null : data.billingPhone,
        billing_email: data.billingSame ? null : data.billingEmail,
        billing_terms: billingTermsNum,
        business_address: data.businessAddress, business_city: data.businessCity,
        business_state: data.businessState, business_zip: data.businessZip,
      }]).select().single();
      if (custErr) { setError("Failed to create customer: " + custErr.message); setSaving(false); return; }
      if (nc) customerId = nc.id;
      if (customerId && !data.billingSame && data.billingName.trim()) {
        const { error: bcErr } = await supabase.from("customer_contacts").insert([{
          customer_id: customerId,
          name: data.billingName.trim(),
          phone: data.billingPhone || null,
          email: data.billingEmail || null,
          role: "Billing Contact",
          is_primary: true,
        }]);
        if (bcErr) alert(`Customer saved, but billing contact didn't save: ${bcErr.message}. Add it from the customer record.`);
      }
    }

    const { data: newJob, error: err } = await supabase.from("call_log").insert([{
      job_number: jobNum, display_job_number: displayJobNum, job_name: data.projectName || null,
      customer_name: name, customer_type: data.customerType, customer_id: customerId,
      sales_name: data.salesName, stage: data.stage,
      bid_due: data.bidDue || null,
      follow_up: data.wantFollowUp ? data.followUp || null : null,
      notes: data.notes,
      is_change_order: data.jobType === "co",
      parent_job_id: data.jobType === "co" && data.parentJobId ? parseInt(data.parentJobId) : null,
      co_number: coNum,
      co_standalone: data.jobType === "co" ? data.coStandalone : false,
      jobsite_address: (data.jobsiteSame ? data.businessAddress : data.jobsiteAddress) || null,
      jobsite_city: (data.jobsiteSame ? data.businessCity : data.jobsiteCity) || null,
      jobsite_state: (data.jobsiteSame ? data.businessState : data.jobsiteState) || null,
      jobsite_zip: (data.jobsiteSame ? data.businessZip : data.jobsiteZip) || null,
      new_site_build: data.newSiteBuild || false,
      billing_address: billingAddrStreet || null, billing_city: billingAddrCity || null,
      billing_state: billingAddrState || null, billing_zip: billingAddrZip || null,
      billing_address_same: data.billingAddressSame,
    }]).select().single();

    if (err) { setError(err.message); setSaving(false); return; }

    if (data.selectedWorkTypes.length > 0) {
      const { error: jwtErr } = await supabase.from("job_work_types").insert(
        data.selectedWorkTypes.map(id => ({ call_log_id: newJob.id, work_type_id: id }))
      );
      if (jwtErr) alert("Warning: work types save failed: " + jwtErr.message);
    }

    if (data.attachments.length > 0) await uploadFiles(newJob.id);

    // Save additional contacts to customer_contacts (skip rows that duplicate the Billing Contact just inserted by new-customer flow)
    if (customerId && data.additionalContacts.length > 0) {
      const billingKey = data.customerMode === "new" && !data.billingSame
        ? `${data.billingName.trim().toLowerCase()}|${(data.billingEmail || "").trim().toLowerCase()}`
        : null;
      const newContacts = data.additionalContacts.filter(c => {
        if (c.existingId) return false;
        if (!c.name && !c.email) return false;
        if (billingKey && c.role === "Billing Contact" &&
            `${c.name.trim().toLowerCase()}|${(c.email || "").trim().toLowerCase()}` === billingKey) return false;
        return true;
      });
      if (newContacts.length > 0) {
        const { error: acErr } = await supabase.from("customer_contacts").insert(
          newContacts.map(c => ({ customer_id: customerId, name: c.name, phone: c.phone, email: c.email, role: c.role }))
        );
        if (acErr) alert(`Couldn't save additional contacts: ${acErr.message}. Add them from the customer record.`);
      }
    }

    setSaving(false);
    onSaved();
  };

  const renderStep = () => {
    switch (currentKey) {

      case "jobType": return (
        <div>
          <StepLabel n={step + 1} label="What type of job is this?" />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <ChoiceBtn label="Standard Job" sub="Auto-assign next job number" selected={data.jobType === "standard"} onClick={() => { set("jobType", "standard"); next(); }} />
            <ChoiceBtn label="Manager Override" sub="Manually set the job number" selected={data.jobType === "override"} onClick={() => { set("jobType", "override"); next(); }} />
            <ChoiceBtn label="Change Order" sub="Add a CO to an existing job" selected={data.jobType === "co"} onClick={() => { set("jobType", "co"); next(); }} />
          </div>
        </div>
      );

      case "manualNum": return (
        <div>
          <StepLabel n={step + 1} label="Enter Job Number" />
          <input type="number" value={data.manualJobNum} onChange={e => set("manualJobNum", e.target.value)} placeholder="e.g. 7650" style={inputStyle} autoFocus />
        </div>
      );

      case "parentJob": return (
        <div>
          <StepLabel n={step + 1} label="Select Parent Job" />
          <select value={data.parentJobId} onChange={e => set("parentJobId", e.target.value)} style={inputStyle}>
            <option value="">— Select Parent Job —</option>
            {allJobs.filter(j => !j.is_change_order).map(j => (
              <option key={j.id} value={j.id}>{j.display_job_number || j.job_name}</option>
            ))}
          </select>
        </div>
      );

      case "coTreatment": return (
        <div>
          <StepLabel n={step + 1} label="How should this CO be treated?" />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <ChoiceBtn label="Wrap into Parent Job" sub="CO proposals and invoices live under the original job" selected={!data.coStandalone} onClick={() => { set("coStandalone", false); next(); }} />
            <ChoiceBtn label="Standalone Record" sub="CO becomes its own independent job record" selected={data.coStandalone} onClick={() => { set("coStandalone", true); next(); }} />
          </div>
        </div>
      );

      case "customerType": return (
        <div>
          <StepLabel n={step + 1} label="Customer Type" />
          <div style={{ display: "flex", gap: 10 }}>
            <ChoiceBtn label="Commercial" sub="Business name" selected={data.customerType === "Commercial"} onClick={() => { set("customerType", "Commercial"); set("customerId", null); set("customerMode", "existing"); next(); }} />
            <ChoiceBtn label="Residential" sub="First & last name" selected={data.customerType === "Residential"} onClick={() => { set("customerType", "Residential"); set("customerId", null); set("customerMode", "existing"); next(); }} />
          </div>
        </div>
      );

      case "customerSelect": return (
        <div>
          <StepLabel n={step + 1} label="Select or Add Customer" />
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <ChoiceBtn label="Existing Customer" selected={data.customerMode === "existing"} onClick={() => set("customerMode", "existing")} />
            <ChoiceBtn label="New Customer" selected={data.customerMode === "new"} onClick={() => set("customerMode", "new")} />
          </div>
          {data.customerMode === "existing" && (
            <SearchSelect
              value={data.customerId}
              placeholder="— Select Customer —"
              options={customers.filter(c => c.customer_type === data.customerType).map(c => ({ value: c.id, label: c.name }))}
              onChange={(val) => {
                const chosen = customers.find(c => c.id === val);
                set("customerId", val);
                if (chosen) {
                  set("customerType", chosen.customer_type);
                  if (chosen.billing_terms) {
                    const std = [5,15,30,45,60,90,120];
                    if (std.includes(chosen.billing_terms)) { set("billingTerms", String(chosen.billing_terms)); set("billingTermsCustom", ""); }
                    else { set("billingTerms", "custom"); set("billingTermsCustom", String(chosen.billing_terms)); }
                  }
                  if (chosen.business_address) set("businessAddress", chosen.business_address);
                  if (chosen.business_city) set("businessCity", chosen.business_city);
                  if (chosen.business_state) set("businessState", chosen.business_state);
                  if (chosen.business_zip) set("businessZip", chosen.business_zip);
                  const cName = [chosen.first_name, chosen.last_name].filter(Boolean).join(" ");
                  if (cName) set("contactName", cName);
                  if (chosen.contact_phone) set("contactPhone", chosen.contact_phone);
                  else if (chosen.phone) set("contactPhone", chosen.phone);
                  if (chosen.contact_email) set("contactEmail", chosen.contact_email);
                  else if (chosen.email) set("contactEmail", chosen.email);
                  if (chosen.billing_name)  set("billingName",  chosen.billing_name);
                  if (chosen.billing_phone) set("billingPhone", chosen.billing_phone);
                  if (chosen.billing_email) set("billingEmail", chosen.billing_email);
                  set("additionalContacts", []);
                }
              }}
            />
          )}
          {data.customerMode === "new" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {data.customerType === "Residential" ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <input placeholder="First Name" value={data.firstName} onChange={e => set("firstName", e.target.value)} style={inputStyle} />
                  <input placeholder="Last Name" value={data.lastName} onChange={e => set("lastName", e.target.value)} style={inputStyle} />
                </div>
              ) : (
                <input placeholder="Business Name" value={data.businessName} onChange={e => set("businessName", e.target.value)} style={inputStyle} />
              )}
              <button onClick={() => set("billingSame", !data.billingSame)} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: "4px 0", marginTop: 4 }}>
                <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${!data.billingSame ? C.teal : C.borderStrong}`, background: !data.billingSame ? C.teal : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {!data.billingSame && <span style={{ color: C.dark, fontSize: 11, fontWeight: 900 }}>✓</span>}
                </div>
                <span style={{ fontSize: 13.5, color: C.textBody, fontFamily: F.ui }}>Is there a separate billing contact?</span>
              </button>
              {!data.billingSame && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px", background: C.linen, borderRadius: 8, border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.ui }}>Billing Contact</div>
                  <input placeholder="Billing Contact Name" value={data.billingName} onChange={e => set("billingName", e.target.value)} style={inputStyle} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <input placeholder="Billing Phone" value={data.billingPhone} onChange={e => set("billingPhone", e.target.value)} style={inputStyle} />
                    <input placeholder="Billing Email" value={data.billingEmail} onChange={e => set("billingEmail", e.target.value)} style={inputStyle} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      );

      case "projectName": return (
        <div>
          <StepLabel n={step + 1} label="Project Name" />
          <div style={{ fontSize: 12, color: C.textMuted, fontFamily: F.ui, marginBottom: 12 }}>
            A short name for this project (e.g. "Warehouse Demo", "Lobby Polish"). This replaces the customer name in job number displays for easier scanning.
          </div>
          <input
            placeholder="e.g. Warehouse Demo, Lobby Polish"
            value={data.projectName}
            onChange={e => set("projectName", e.target.value)}
            style={inputStyle}
            autoFocus
          />
        </div>
      );

      case "contactInfo": return (
        <div>
          <StepLabel n={step + 1} label="Contact Information" />
          <ContactBillingPicker
            customerId={data.customerId}
            customerMode={data.customerMode}
            customerName={customers.find(c => c.id === data.customerId)?.name || ""}
            contactValues={{
              contactName: data.contactName,
              contactPhone: data.contactPhone,
              contactEmail: data.contactEmail,
            }}
            billingValues={{
              billingName: data.billingName,
              billingPhone: data.billingPhone,
              billingEmail: data.billingEmail,
            }}
            onContactChange={patch => setData(d => ({ ...d, ...patch }))}
            onBillingChange={patch => setData(d => ({ ...d, ...patch }))}
            onBillingLockChange={(locked, contactId) =>
              setData(d => ({
                ...d,
                billingSourceContactId: locked ? contactId : null,
                billingSame: locked ? false : d.billingSame,
              }))
            }
            hideBilling={data.customerMode === "new"}
          />
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.ui, marginBottom: 4 }}>Billing Terms</div>
            <select value={data.billingTerms} onChange={e => set("billingTerms", e.target.value)} style={inputStyle}>
              <option value="5">Net 5</option>
              <option value="15">Net 15</option>
              <option value="30">Net 30</option>
              <option value="45">Net 45</option>
              <option value="60">Net 60</option>
              <option value="90">Net 90</option>
              <option value="120">Net 120</option>
              <option value="custom">Custom</option>
            </select>
            {data.billingTerms === "custom" && (
              <input type="number" placeholder="Days" value={data.billingTermsCustom || ""} onChange={e => set("billingTermsCustom", e.target.value)} style={{ ...inputStyle, marginTop: 8 }} />
            )}
          </div>

          {/* Additional Contacts */}
          <div style={{ marginTop: 16 }}>
            {data.additionalContacts.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 10 }}>
                {data.additionalContacts.map((c, i) => (
                  <div key={i} style={{ padding: "12px 14px", background: C.linen, borderRadius: 10, border: `1.5px solid ${C.borderStrong}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textFaint, fontFamily: F.display }}>Contact {i + 2}</span>
                      <button onClick={() => set("additionalContacts", data.additionalContacts.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: C.textFaint, cursor: "pointer", fontSize: 16, padding: 0, lineHeight: 1 }}>×</button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <input placeholder="Name" value={c.name} onChange={e => { const upd = [...data.additionalContacts]; upd[i] = { ...upd[i], name: e.target.value }; set("additionalContacts", upd); }} style={inputStyle} />
                        <select value={c.role} onChange={e => { const upd = [...data.additionalContacts]; upd[i] = { ...upd[i], role: e.target.value }; set("additionalContacts", upd); }} style={inputStyle}>
                          <option value="Project Manager">Project Manager</option>
                          <option value="Office Manager">Office Manager</option>
                          <option value="Billing Contact">Billing Contact</option>
                        </select>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <input placeholder="Phone" value={c.phone} onChange={e => { const upd = [...data.additionalContacts]; upd[i] = { ...upd[i], phone: e.target.value }; set("additionalContacts", upd); }} style={inputStyle} />
                        <input placeholder="Email" value={c.email} onChange={e => { const upd = [...data.additionalContacts]; upd[i] = { ...upd[i], email: e.target.value }; set("additionalContacts", upd); }} style={inputStyle} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => set("additionalContacts", [...data.additionalContacts, { name: "", phone: "", email: "", role: "Project Manager" }])}
              style={{ background: "none", border: `1.5px dashed ${C.borderStrong}`, borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 700, color: C.textMuted, cursor: "pointer", fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase", width: "100%" }}
            >
              + Add Contact
            </button>
          </div>

        </div>
      );

      case "addresses": return (
        <div>
          <StepLabel n={step + 1} label="Addresses" />
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ padding: 16, background: C.linen, borderRadius: 10, border: `1.5px solid ${C.borderStrong}` }}>
              <AddressBlock label={data.customerType === "Residential" ? "Customer Address" : "Business Address"} required sectionKey="business"
                fields={{ address: data.businessAddress, city: data.businessCity, state: data.businessState, zip: data.businessZip }} set={set} />
            </div>
            <div style={{ padding: 16, background: C.linen, borderRadius: 10, border: `1.5px solid ${C.borderStrong}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.ui, display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                Job Site Address
                <span style={{ fontSize: 10, color: C.textFaint, background: C.linenLight, padding: "1px 6px", borderRadius: 4, border: `1px solid ${C.border}` }}>OPTIONAL</span>
              </div>
              <button onClick={() => set("jobsiteSame", !data.jobsiteSame)} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: "2px 0", marginBottom: 10 }}>
                <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${data.jobsiteSame ? C.teal : C.borderStrong}`, background: data.jobsiteSame ? C.teal : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {data.jobsiteSame && <span style={{ color: C.dark, fontSize: 11, fontWeight: 900 }}>✓</span>}
                </div>
                <span style={{ fontSize: 13.5, color: C.textBody, fontFamily: F.ui }}>Same as {data.customerType === "Residential" ? "customer" : "business"} address</span>
              </button>
              {!data.jobsiteSame && (
                <>
                  <AddressBlock label="" required={false} sectionKey="jobsite"
                    fields={{ address: data.jobsiteAddress, city: data.jobsiteCity, state: data.jobsiteState, zip: data.jobsiteZip }} set={set} />
                  {!data.jobsiteAddress && !data.newSiteBuild && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, padding: "7px 10px", background: "rgba(230,168,0,0.08)", borderRadius: 7, border: "1px solid rgba(230,168,0,0.25)" }}>
                      <span style={{ fontSize: 13 }}>⚠️</span>
                      <span style={{ fontSize: 12, color: "#a07800", fontFamily: F.ui, fontWeight: 600 }}>Required before a proposal can be created</span>
                    </div>
                  )}
                  <button onClick={() => set("newSiteBuild", !data.newSiteBuild)} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: "4px 0", marginTop: 10 }}>
                    <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${data.newSiteBuild ? C.teal : C.borderStrong}`, background: data.newSiteBuild ? C.teal : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {data.newSiteBuild && <span style={{ color: C.dark, fontSize: 11, fontWeight: 900 }}>✓</span>}
                    </div>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: C.textMuted, fontFamily: F.ui }}>New Site Build — No Address Available Yet</span>
                  </button>
                </>
              )}
            </div>
            <div style={{ padding: 16, background: C.linen, borderRadius: 10, border: `1.5px solid ${C.borderStrong}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.ui, display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                Billing Address
                <span style={{ fontSize: 10, color: C.textFaint, background: C.linenLight, padding: "1px 6px", borderRadius: 4, border: `1px solid ${C.border}` }}>OPTIONAL</span>
              </div>
              <button onClick={() => set("billingAddressSame", !data.billingAddressSame)} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: "2px 0", marginBottom: 10 }}>
                <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${data.billingAddressSame ? C.teal : C.borderStrong}`, background: data.billingAddressSame ? C.teal : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {data.billingAddressSame && <span style={{ color: C.dark, fontSize: 11, fontWeight: 900 }}>✓</span>}
                </div>
                <span style={{ fontSize: 13.5, color: C.textBody, fontFamily: F.ui }}>Same as {data.customerType === "Residential" ? "customer" : "business"} address</span>
              </button>
              {!data.billingAddressSame && (
                <AddressBlock label="" required={false} sectionKey="billingAddr"
                  fields={{ address: data.billingAddrStreet, city: data.billingAddrCity, state: data.billingAddrState, zip: data.billingAddrZip }} set={set} />
              )}
            </div>
          </div>
        </div>
      );

      case "salesRep": return (
        <div>
          <StepLabel n={step + 1} label="Sales Rep & Stage" />
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <select value={data.salesName} onChange={e => set("salesName", e.target.value)} style={inputStyle}>
              <option value="">— Select Sales Rep —</option>
              {team.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.ui }}>Stage</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {STAGES.map(st => (
                  <button key={st} onClick={() => set("stage", st)} style={{ padding: "7px 14px", borderRadius: 20, border: `1.5px solid ${data.stage === st ? C.teal : C.border}`, background: data.stage === st ? C.dark : "transparent", color: data.stage === st ? C.teal : C.textMuted, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: F.display, textTransform: "uppercase", letterSpacing: "0.05em" }}>{st}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
      );

      case "workTypes": {
        const filtered = wtSearch.trim()
          ? workTypes.filter(wt => wt.name.toLowerCase().includes(wtSearch.trim().toLowerCase()) || (wt.cost_code || "").toLowerCase().includes(wtSearch.trim().toLowerCase()))
          : workTypes;
        return (
        <div>
          <StepLabel n={step + 1} label="Work Types (select all that apply)" />
          <input
            placeholder="Search work types…"
            value={wtSearch}
            onChange={e => setWtSearch(e.target.value)}
            style={{ ...inputStyle, marginBottom: 10 }}
            autoFocus
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflowY: "auto", paddingRight: 4 }}>
            {filtered.map(wt => {
              const sel = data.selectedWorkTypes.includes(wt.id);
              return (
                <button key={wt.id} onClick={() => set("selectedWorkTypes", sel ? data.selectedWorkTypes.filter(x => x !== wt.id) : [...data.selectedWorkTypes, wt.id])}
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
      ); }

      case "bidDue": return (
        <div>
          <StepLabel n={step + 1} label="Bid Due Date" />
          <input type="date" value={data.bidDue} onChange={e => set("bidDue", e.target.value)} onClick={e => e.target.showPicker?.()} style={{ ...inputStyle, cursor: "pointer" }} autoFocus />
        </div>
      );

      case "followUp": return (
        <div>
          <StepLabel n={step + 1} label="Would you like to add a follow-up date?" />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 10 }}>
              <ChoiceBtn label="Yes" selected={data.wantFollowUp === true} onClick={() => set("wantFollowUp", true)} />
              <ChoiceBtn label="No" selected={data.wantFollowUp === false} onClick={() => { set("wantFollowUp", false); next(); }} />
            </div>
            {data.wantFollowUp === true && (
              <input type="date" value={data.followUp} onChange={e => set("followUp", e.target.value)} onClick={e => e.target.showPicker?.()} style={{ ...inputStyle, cursor: "pointer" }} autoFocus />
            )}
          </div>
          <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui, marginTop: 12 }}>
            ℹ A 30-day reminder will be sent to the sales rep if this job's status hasn't changed.
          </div>
        </div>
      );

      case "notes": return (
        <div>
          <StepLabel n={step + 1} label="Notes & Attachments" />
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <textarea value={data.notes} onChange={e => set("notes", e.target.value)} rows={4} placeholder="Add any notes about this job…"
              style={{ ...inputStyle, resize: "vertical" }} />
            <div>
              <input ref={fileRef} type="file" multiple accept="image/*,.pdf,.doc,.docx" style={{ display: "none" }}
                onChange={e => set("attachments", [...data.attachments, ...Array.from(e.target.files)])} />
              <Btn v="ghost" onClick={() => fileRef.current.click()}>+ Add Files / Photos</Btn>
            </div>
            {data.attachments.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {data.attachments.map((f, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 12px", background: C.linen, borderRadius: 7, border: `1px solid ${C.border}` }}>
                    <span style={{ fontSize: 13, fontFamily: F.ui, color: C.textBody }}>{f.name}</span>
                    <button onClick={() => set("attachments", data.attachments.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: C.textFaint, fontSize: 16 }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      );

      default: return null;
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(28,24,20,0.65)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {/* Left arrow — absolutely positioned, always same spot */}
      <div style={{ position: "fixed", top: "50%", left: "calc(50% - 364px)", transform: "translateY(-50%)", zIndex: 101 }}>
        {step > (preset ? 2 : 0) ? (
          <NavCircle onClick={back}>←</NavCircle>
        ) : (
          <div style={{ width: 48 }} />
        )}
      </div>
      {/* Right arrow — absolutely positioned, always same spot */}
      <div style={{ position: "fixed", top: "50%", right: "calc(50% - 364px)", transform: "translateY(-50%)", zIndex: 101 }}>
        <NavCircle onClick={handleNext} disabled={saving} primary>
          {isLastStep ? "✓" : "→"}
        </NavCircle>
      </div>
      {/* Modal body — auto-height, grows/shrinks with content like original */}
      <div style={{ background: C.linenCard, borderRadius: 14, padding: 32, width: 620, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.45)", border: `1px solid ${C.borderStrong}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>New Inquiry</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: C.textFaint }}>✕</button>
        </div>
        <div style={{ background: C.dark, borderRadius: 9, padding: "10px 16px", marginBottom: 24, border: `1px solid ${C.tealBorder}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(255,255,255,0.3)", fontFamily: F.ui, marginBottom: 3 }}>Job Number Preview</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.teal, fontFamily: F.display, letterSpacing: "0.04em" }}>{previewDisplay}</div>
        </div>
        {renderStep()}
        {error && <div style={{ color: C.red, fontSize: 13, fontFamily: F.ui, marginTop: 12, textAlign: "center" }}>{error}</div>}
        <div style={{ fontSize: 11, fontWeight: 700, color: C.textFaint, fontFamily: F.ui, letterSpacing: "0.08em", textTransform: "uppercase", textAlign: "center", marginTop: 16 }}>
          {step + 1} / {stepList.length}
        </div>
      </div>
    </div>
  );
}

export default NewInquiryWizard;
