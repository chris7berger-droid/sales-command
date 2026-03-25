import { useEffect, useState, useRef } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import { fmtD, over } from "../lib/utils";
import { STAGES, STAGE_C } from "../lib/mockData";
import SectionHeader from "../components/SectionHeader";
import DataTable from "../components/DataTable";
import Pill from "../components/Pill";
import Btn from "../components/Btn";
import CallLogDetail from "../components/CallLogDetail";

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
      {required && <span style={{ fontSize: 10, color: C.teal, background: "rgba(0,180,160,0.12)", padding: "1px 6px", borderRadius: 4, letterSpacing: "0.08em" }}>REQUIRED</span>}
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

const StepFooter = ({ step, back, onNext, nextLabel = "Next →", disabled = false, error }) => (
  <div style={{ marginTop: 16 }}>
    {error && <div style={{ color: C.red, fontSize: 13, fontFamily: F.ui, marginBottom: 8 }}>{error}</div>}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      {step > 0 ? (
        <button onClick={back} style={{ background: "none", border: "none", cursor: "pointer", color: C.tealDark, fontWeight: 800, fontSize: 12, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", padding: 0 }}>
          ← Back
        </button>
      ) : <div />}
      <Btn onClick={onNext} disabled={disabled}>{nextLabel}</Btn>
    </div>
  </div>
);

function buildStepList(jobType) {
  const steps = ["jobType"];
  if (jobType === "override") steps.push("manualNum");
  if (jobType === "co") { steps.push("parentJob"); steps.push("coTreatment"); }
  steps.push("customerType");
  steps.push("customerSelect");
  steps.push("contactInfo");
  steps.push("addresses");
  steps.push("salesRep");
  steps.push("workTypes");
  steps.push("bidDue");
  steps.push("followUp");
  steps.push("notes");
  return steps;
}

function NewInquiryWizard({ onClose, onSaved, team, customers, allJobs, workTypes }) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef();

  const [data, setData] = useState({
    jobType: null,
    manualJobNum: "",
    parentJobId: "",
    coStandalone: false,
    customerType: null,
    customerMode: null,
    customerId: "",
    firstName: "",
    lastName: "",
    businessName: "",
    contactPhone: "",
    contactEmail: "",
    billingSame: true,
    billingName: "",
    billingPhone: "",
    billingEmail: "",
    businessAddress: "", businessCity: "", businessState: "", businessZip: "",
    jobsiteAddress: "", jobsiteCity: "", jobsiteState: "", jobsiteZip: "",
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
  });

  const set = (k, v) => setData(d => ({ ...d, [k]: v }));
  const stepList = buildStepList(data.jobType);
  const currentKey = stepList[step];
  const next = () => { setError(null); setStep(s => s + 1); };
  const back = () => { setError(null); setStep(s => s - 1); };

  const custName = () => {
    if (data.customerMode === "existing") return customers.find(c => c.id === data.customerId)?.name || "";
    if (data.customerType === "Residential") return `${data.firstName} ${data.lastName}`.trim();
    return data.businessName.trim();
  };

  const previewNum = data.jobType === "override" && data.manualJobNum ? data.manualJobNum : "####";
  const previewCO = data.jobType === "co" && data.parentJobId ? " CO#" : "";
  const previewName = custName() || "Customer";
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

    const displayJobNum = data.jobType === "co" && coNum
      ? `${jobNum} CO${coNum} - ${name}`
      : `${jobNum} - ${name}`;

    const billingAddrStreet = data.billingAddressSame ? data.businessAddress : data.billingAddrStreet;
    const billingAddrCity   = data.billingAddressSame ? data.businessCity    : data.billingAddrCity;
    const billingAddrState  = data.billingAddressSame ? data.businessState   : data.billingAddrState;
    const billingAddrZip    = data.billingAddressSame ? data.businessZip     : data.billingAddrZip;

    let customerId = data.customerId || null;
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
        business_address: data.businessAddress, business_city: data.businessCity,
        business_state: data.businessState, business_zip: data.businessZip,
      }]).select().single();
      if (custErr) { setError("Failed to create customer: " + custErr.message); setSaving(false); return; }
      if (nc) customerId = nc.id;
    }

    const { data: newJob, error: err } = await supabase.from("call_log").insert([{
      job_number: jobNum, display_job_number: displayJobNum, job_name: displayJobNum,
      customer_name: name, customer_type: data.customerType, customer_id: customerId,
      sales_name: data.salesName, stage: data.stage,
      bid_due: data.bidDue || null,
      follow_up: data.wantFollowUp ? data.followUp || null : null,
      notes: data.notes,
      is_change_order: data.jobType === "co",
      parent_job_id: data.jobType === "co" && data.parentJobId ? parseInt(data.parentJobId) : null,
      co_number: coNum,
      co_standalone: data.jobType === "co" ? data.coStandalone : false,
      jobsite_address: data.jobsiteAddress || null, jobsite_city: data.jobsiteCity || null,
      jobsite_state: data.jobsiteState || null, jobsite_zip: data.jobsiteZip || null,
      billing_address: billingAddrStreet || null, billing_city: billingAddrCity || null,
      billing_state: billingAddrState || null, billing_zip: billingAddrZip || null,
      billing_address_same: data.billingAddressSame,
    }]).select().single();

    if (err) { setError(err.message); setSaving(false); return; }

    if (data.selectedWorkTypes.length > 0) {
      const { error: jwtErr } = await supabase.from("job_work_types").insert(
        data.selectedWorkTypes.map(id => ({ call_log_id: newJob.id, work_type_id: id }))
      );
      if (jwtErr) console.error("job_work_types insert failed:", jwtErr.message);
    }

    if (data.attachments.length > 0) await uploadFiles(newJob.id);
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
          <StepFooter step={step} back={back} error={error} onNext={() => { if (!data.manualJobNum) { setError("Job number required"); return; } next(); }} />
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
          <StepFooter step={step} back={back} error={error} onNext={() => { if (!data.parentJobId) { setError("Select a parent job"); return; } next(); }} />
        </div>
      );

      case "coTreatment": return (
        <div>
          <StepLabel n={step + 1} label="How should this CO be treated?" />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <ChoiceBtn label="Wrap into Parent Job" sub="CO proposals and invoices live under the original job" selected={!data.coStandalone} onClick={() => { set("coStandalone", false); next(); }} />
            <ChoiceBtn label="Standalone Record" sub="CO becomes its own independent job record" selected={data.coStandalone} onClick={() => { set("coStandalone", true); next(); }} />
          </div>
          <StepFooter step={step} back={back} error={error} onNext={next} />
        </div>
      );

      case "customerType": return (
        <div>
          <StepLabel n={step + 1} label="Customer Type" />
          <div style={{ display: "flex", gap: 10 }}>
            <ChoiceBtn label="Commercial" sub="Business name" selected={data.customerType === "Commercial"} onClick={() => { set("customerType", "Commercial"); set("customerId", null); set("customerMode", "existing"); next(); }} />
            <ChoiceBtn label="Residential" sub="First & last name" selected={data.customerType === "Residential"} onClick={() => { set("customerType", "Residential"); set("customerId", null); set("customerMode", "existing"); next(); }} />
          </div>
          <StepFooter step={step} back={back} error={error} onNext={next} />
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
            <select value={data.customerId} onChange={e => {
              const chosen = customers.find(c => c.id === e.target.value)
              set("customerId", e.target.value)
              if (chosen) set("customerType", chosen.customer_type)
            }} style={inputStyle}>
              <option value="">— Select Customer —</option>
              {customers.filter(c => c.customer_type === data.customerType).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
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
            </div>
          )}
          <StepFooter step={step} back={back} error={error} onNext={() => {
            if (!data.customerMode) { setError("Select an option"); return; }
            if (data.customerMode === "existing" && !data.customerId) { setError("Select a customer"); return; }
            if (data.customerMode === "new") {
              if (data.customerType === "Residential" && (!data.firstName || !data.lastName)) { setError("First and last name required"); return; }
              if (data.customerType === "Commercial" && !data.businessName) { setError("Business name required"); return; }
            }
            next();
          }} />
        </div>
      );

      case "contactInfo": return (
        <div>
          <StepLabel n={step + 1} label="Contact Information" />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <input placeholder="Phone" value={data.contactPhone} onChange={e => set("contactPhone", e.target.value)} style={inputStyle} />
              <input placeholder="Email" value={data.contactEmail} onChange={e => set("contactEmail", e.target.value)} style={inputStyle} />
            </div>
            <button onClick={() => set("billingSame", !data.billingSame)} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}>
              <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${data.billingSame ? C.teal : C.borderStrong}`, background: data.billingSame ? C.teal : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {data.billingSame && <span style={{ color: C.dark, fontSize: 11, fontWeight: 900 }}>✓</span>}
              </div>
              <span style={{ fontSize: 13.5, color: C.textBody, fontFamily: F.ui }}>Billing contact is the same as above</span>
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
          <StepFooter step={step} back={back} error={error} onNext={next} />
        </div>
      );

      case "addresses": return (
        <div>
          <StepLabel n={step + 1} label="Addresses" />
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ padding: 16, background: C.linen, borderRadius: 10, border: `1.5px solid ${C.borderStrong}` }}>
              <AddressBlock label="Business Address" required sectionKey="business"
                fields={{ address: data.businessAddress, city: data.businessCity, state: data.businessState, zip: data.businessZip }} set={set} />
            </div>
            <div style={{ padding: 16, background: C.linen, borderRadius: 10, border: `1.5px solid ${C.borderStrong}` }}>
              <AddressBlock label="Job Site Address" required={false} sectionKey="jobsite"
                fields={{ address: data.jobsiteAddress, city: data.jobsiteCity, state: data.jobsiteState, zip: data.jobsiteZip }} set={set} />
              {!data.jobsiteAddress && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, padding: "7px 10px", background: "rgba(230,168,0,0.08)", borderRadius: 7, border: "1px solid rgba(230,168,0,0.25)" }}>
                  <span style={{ fontSize: 13 }}>⚠️</span>
                  <span style={{ fontSize: 12, color: "#a07800", fontFamily: F.ui, fontWeight: 600 }}>Required before a proposal can be created</span>
                </div>
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
                <span style={{ fontSize: 13.5, color: C.textBody, fontFamily: F.ui }}>Same as business address</span>
              </button>
              {!data.billingAddressSame && (
                <AddressBlock label="" required={false} sectionKey="billingAddr"
                  fields={{ address: data.billingAddrStreet, city: data.billingAddrCity, state: data.billingAddrState, zip: data.billingAddrZip }} set={set} />
              )}
            </div>
          </div>
          <StepFooter step={step} back={back} error={error} onNext={() => {
            if (!data.businessAddress || !data.businessCity || !data.businessState || !data.businessZip) {
              setError("Business address is required (street, city, state, zip)");
              return;
            }
            next();
          }} />
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
          <StepFooter step={step} back={back} error={error} onNext={() => { if (!data.salesName) { setError("Select a sales rep"); return; } next(); }} />
        </div>
      );

      case "workTypes": return (
        <div>
          <StepLabel n={step + 1} label="Work Types (select all that apply)" />
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto", paddingRight: 4 }}>
            {workTypes.map(wt => {
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
          <StepFooter step={step} back={back} error={error} onNext={() => { if (data.selectedWorkTypes.length === 0) { setError("Select at least one work type"); return; } next(); }} />
        </div>
      );

      case "bidDue": return (
        <div>
          <StepLabel n={step + 1} label="Bid Due Date" />
          <input type="date" value={data.bidDue} onChange={e => set("bidDue", e.target.value)} onClick={e => e.target.showPicker?.()} style={{ ...inputStyle, cursor: "pointer" }} autoFocus />
          <StepFooter step={step} back={back} error={error} onNext={() => { if (!data.bidDue) { setError("Bid due date is required"); return; } next(); }} />
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
          <StepFooter step={step} back={back} error={error} onNext={next} />
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
          <StepFooter step={step} back={back} error={error} onNext={save} nextLabel={saving ? "Saving…" : "Save Inquiry ✓"} disabled={saving} />
        </div>
      );

      default: return null;
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(28,24,20,0.65)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: C.linenCard, borderRadius: 14, padding: 32, width: 580, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.45)", border: `1px solid ${C.borderStrong}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>New Inquiry</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: C.textFaint }}>✕</button>
        </div>
        <div style={{ background: C.dark, borderRadius: 9, padding: "10px 16px", marginBottom: 24, border: `1px solid ${C.tealBorder}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(255,255,255,0.3)", fontFamily: F.ui, marginBottom: 3 }}>Job Number Preview</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.teal, fontFamily: F.display, letterSpacing: "0.04em" }}>{previewDisplay}</div>
        </div>
        {renderStep()}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function CallLog({ teamMember, onNewProposal, bidDueFilter, onClearBidDueFilter, stageFilter, onClearStageFilter }) {
  const [rows, setRows]           = useState([]);
  const [team, setTeam]           = useState([]);
  const [customers, setCustomers] = useState([]);
  const [workTypes, setWorkTypes] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState(stageFilter || "All");
  const [q, setQ]                 = useState("");
  const [showModal, setShowModal] = useState(false);
  const [selJob, setSelJob]       = useState(null);  // SC-20

  const load = async () => {
    const [{ data: log }, { data: tm }, { data: cx }, { data: wt }] = await Promise.all([
      supabase.from("call_log").select("*, job_work_types(*)").order("id", { ascending: false }),
      supabase.from("team_members").select("*").order("name"),
      supabase.from("customers").select("*").order("name"),
      supabase.from("work_types").select("*").order("name"),
    ]);
    setRows(log || []);
    setTeam(tm || []);
    setCustomers(cx || []);
    setWorkTypes(wt || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (stageFilter) {
      setFilter(stageFilter);
      onClearStageFilter && onClearStageFilter();
    }
  }, [stageFilter]);

  // SC-20 — show detail page when a job is selected
  if (selJob) {
    return (
      <CallLogDetail
        job={selJob}
        teamMembers={team}
        workTypes={workTypes}
        onBack={() => setSelJob(null)}
        onSaved={() => { setSelJob(null); load(); }}
        onDeleted={() => { setSelJob(null); load(); }}
        teamMember={teamMember}
        onNewProposal={onNewProposal ? () => onNewProposal(selJob) : undefined}
      />
    );
  }

  const tod = new Date().toISOString().slice(0, 10);
  const filtered = rows.filter(r =>
    (bidDueFilter ? r.bid_due === tod : (filter === "All" || r.stage === filter)) &&
    ((r.display_job_number || r.job_name)?.toLowerCase().includes(q.toLowerCase()) ||
     String(r.job_number || r.id).includes(q))
  );

  return (
    <>
      {showModal && (
        <NewInquiryWizard
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load(); }}
          team={team}
          customers={customers}
          allJobs={rows}
          workTypes={workTypes}
        />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <SectionHeader title="Call Log" action={<Btn sz="sm" onClick={() => setShowModal(true)}>+ New Inquiry</Btn>} />
        {bidDueFilter && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: "rgba(249,168,37,0.12)", border: "1.5px solid rgba(249,168,37,0.4)", borderRadius: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#7a5000" }}>⚠ Showing bids due today only</span>
            <button onClick={() => onClearBidDueFilter && onClearBidDueFilter()} style={{ background: "none", border: "1.5px solid rgba(249,168,37,0.5)", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700, color: "#7a5000", cursor: "pointer", fontFamily: "inherit" }}>✕ Show All</button>
          </div>
        )}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input placeholder="Search job # or name…" value={q} onChange={e => setQ(e.target.value)}
            style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${C.borderStrong}`, background: C.linenLight, fontSize: 13.5, outline: "none", width: 240, color: C.textBody, fontFamily: F.ui }} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["All", ...STAGES].map(st => {
              const count = st === "All" ? rows.length : rows.filter(r => r.stage === st).length;
              return (
                <button key={st} onClick={() => setFilter(st)} style={{ padding: "7px 16px", borderRadius: 20, border: `1.5px solid ${filter === st ? C.teal : C.border}`, background: filter === st ? C.dark : "transparent", color: filter === st ? C.teal : C.textMuted, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  {st} <span style={{ opacity: 0.6, marginLeft: 4 }}>({count})</span>
                </button>
              );
            })}
          </div>
        </div>
        {loading ? (
          <div style={{ color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>Loading...</div>
        ) : (
          <>
            <DataTable
              cols={[
                { k: "job_number", l: "Job #", r: (v, row) => (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 800, color: C.tealDark, fontFamily: F.display, cursor: "pointer", textDecoration: "underline" }} onClick={() => setSelJob(row)}>{row.display_job_number || v}</span>
                    {row.is_change_order && (
                      <span style={{ fontSize: 10.5, fontWeight: 700, background: "rgba(142,68,173,0.12)", color: "#5b2d7a", padding: "2px 7px", borderRadius: 10, fontFamily: F.ui }}>CO</span>
                    )}
                    {!row.jobsite_address && (
                      <span title="Job site address missing — required before proposal" style={{ fontSize: 10, fontWeight: 700, background: "rgba(230,168,0,0.13)", color: "#8a6200", padding: "2px 7px", borderRadius: 10, fontFamily: F.ui, border: "1px solid rgba(230,168,0,0.3)", cursor: "default" }}>
                        ⚠ No Site Addr
                      </span>
                    )}
                  </div>
                )},
                { k: "customer_name", l: "Customer", r: (v, row) => <span style={{ fontWeight: 500 }}>{v || row.job_name}</span> },
                { k: "created_at", l: "Date", r: v => fmtD(v) },
                { k: "stage", l: "Stage", r: v => <Pill label={v} cm={STAGE_C} /> },
                { k: "sales_name", l: "Rep" },
                { k: "bid_due", l: "Bid Due", r: v => <span style={{ color: over(v) ? C.red : C.textBody, fontWeight: 500 }}>{fmtD(v)}</span> },
                { k: "follow_up", l: "Follow Up", r: v => v ? <span style={{ color: over(v) ? C.red : C.textBody }}>{fmtD(v)}</span> : <span style={{ color: C.textFaint }}>—</span> },
                { k: "_a", l: "", r: (_, row) => (
                  <Btn sz="sm" v="secondary" onClick={() => setSelJob(row)}>View</Btn>
                )},
              ]}
              rows={filtered}
            />
            <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui }}>
              {filtered.length} record{filtered.length !== 1 ? "s" : ""}
            </div>
          </>
        )}
      </div>
    </>
  );
}