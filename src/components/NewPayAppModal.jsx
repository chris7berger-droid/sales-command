import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { C, F } from "../lib/tokens";
import { fmt$ } from "../lib/utils";
import { fillPayAppPdf, DEFAULT_DA_BUILDERS_JOB_FIELD_MAP } from "../lib/payAppPdf";
import Btn from "./Btn";

const inputStyle = {
  padding: "7px 10px", borderRadius: 6, border: `1.5px solid ${C.borderStrong}`,
  background: C.linenDeep, color: C.textBody, fontSize: 13, fontFamily: F.ui,
  WebkitAppearance: "none", outline: "none", width: "100%",
};

function todayISO() { return new Date().toISOString().slice(0, 10); }

export default function NewPayAppModal({ schedule, lines, proposal, onClose, onCreated }) {
  const [priorApps, setPriorApps] = useState([]);
  const [priorLines, setPriorLines] = useState([]);
  const [template, setTemplate] = useState(null);
  const [tenantConfig, setTenantConfig] = useState(null);
  const [jobNumber, setJobNumber] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState(todayISO());
  const [typeOfWork, setTypeOfWork] = useState("");
  // pctToDate[line.id] = "0".."100" (% complete to date, not delta)
  const [pctToDate, setPctToDate] = useState({});

  useEffect(() => {
    (async () => {
      const [appsRes, customerRes, tenantRes] = await Promise.all([
        supabase.from("billing_schedule_pay_apps")
          .select("id, app_number, period_to")
          .eq("billing_schedule_id", schedule.id)
          .order("app_number", { ascending: true }),
        supabase.from("call_log").select("customer_id, subcontractor_job_no, job_number").eq("id", proposal.call_log_id).maybeSingle(),
        supabase.from("tenant_config").select("*").single(),
      ]);
      setTenantConfig(tenantRes.data || null);
      setJobNumber(customerRes.data?.subcontractor_job_no || customerRes.data?.job_number || null);
      const apps = appsRes.data || [];
      setPriorApps(apps);

      // Prior pay-app lines for cumulative math
      let priorLineRows = [];
      if (apps.length > 0) {
        const appIds = apps.map(a => a.id);
        const { data } = await supabase
          .from("billing_schedule_pay_app_lines")
          .select("pay_app_id, billing_schedule_line_id, billed_amount_this_app")
          .in("pay_app_id", appIds);
        priorLineRows = data || [];
      }
      setPriorLines(priorLineRows);

      // Initialize pctToDate to empty strings (user enters their % to date).
      // We don't pre-fill prior % because that tempts misreading it as "this app".
      const initPct = {};
      lines.forEach(l => { initPct[l.id] = ""; });
      setPctToDate(initPct);

      // Pick template: prefer job-scoped for this proposal, else default customer-scope
      const customerId = customerRes.data?.customer_id;
      if (customerId) {
        const { data: tmpls } = await supabase
          .from("customer_pay_app_templates")
          .select("*")
          .eq("customer_id", customerId)
          .order("is_default", { ascending: false });
        const jobTmpl = (tmpls || []).find(t => t.scope === "job" && t.proposal_id === proposal.id);
        const custTmpl = (tmpls || []).find(t => t.scope === "customer");
        setTemplate(jobTmpl || custTmpl || null);
      }

      setLoading(false);
    })();
  }, [schedule.id, proposal.id, proposal.call_log_id, lines]);

  // Prior billed amount per line (computed)
  function priorAmountForLine(lineId) {
    return priorLines
      .filter(pl => pl.billing_schedule_line_id === lineId)
      .reduce((s, pl) => s + (parseFloat(pl.billed_amount_this_app) || 0), 0);
  }
  function priorPctForLine(lineId, sv) {
    return sv > 0 ? (priorAmountForLine(lineId) / sv) * 100 : 0;
  }

  // Per-line values for the rendered table + totals
  const computed = lines.map(l => {
    const sv = parseFloat(l.scheduled_value) || 0;
    const prior$ = priorAmountForLine(l.id);
    const priorPct = priorPctForLine(l.id, sv);
    const newPct = parseFloat(pctToDate[l.id]) || 0;
    const newAmount = sv * (newPct / 100);
    const thisAppAmount = Math.max(0, newAmount - prior$);
    return { line: l, sv, prior$, priorPct, newPct, newAmount, thisAppAmount };
  });

  const retainagePct = parseFloat(schedule.retainage_pct) || 0;
  const grossCompletedToDate = computed.reduce((s, c) => s + c.newAmount, 0);
  const previousBillings = computed.reduce((s, c) => s + c.prior$, 0);
  const grossThisBilling = grossCompletedToDate - previousBillings;
  const retentionThisPeriod = grossThisBilling * (retainagePct / 100);
  const currentPaymentDue = grossThisBilling - retentionThisPeriod;

  function validate() {
    if (!periodFrom || !periodTo) return "Period from and to are required";
    if (grossThisBilling <= 0) return "Enter at least one line's % to date above its current value";
    for (const c of computed) {
      if (c.newPct < c.priorPct - 0.001) return `${c.line.description.slice(0, 40)}: % to date cannot be less than previous (${c.priorPct.toFixed(1)}%)`;
      if (c.newPct > 100) return `${c.line.description.slice(0, 40)}: % to date cannot exceed 100%`;
      if (c.newPct < 0) return `${c.line.description.slice(0, 40)}: % to date cannot be negative`;
    }
    return null;
  }

  async function handleCreate() {
    setError(null);
    const vErr = validate();
    if (vErr) { setError(vErr); return; }
    setSaving(true);

    try {
      const nextAppNumber = (priorApps[priorApps.length - 1]?.app_number || 0) + 1;

      // 1. Create pay_app row
      const { data: payApp, error: paErr } = await supabase
        .from("billing_schedule_pay_apps")
        .insert([{
          billing_schedule_id: schedule.id,
          app_number: nextAppNumber,
          period_from: periodFrom,
          period_to: periodTo,
          type_of_work: typeOfWork.trim() || null,
          contract_sum_snapshot: parseFloat(schedule.contract_sum) || 0,
          retainage_pct_snapshot: retainagePct,
          this_app_amount: Math.round(grossThisBilling * 100) / 100,
          retainage_withheld: Math.round(retentionThisPeriod * 100) / 100,
          current_payment_due: Math.round(currentPaymentDue * 100) / 100,
          status: "draft",
        }])
        .select()
        .single();
      if (paErr) throw paErr;

      // 2. Create pay_app_lines
      const lineRows = computed
        .filter(c => c.thisAppAmount > 0 || c.newPct > c.priorPct)
        .map(c => ({
          pay_app_id: payApp.id,
          billing_schedule_line_id: c.line.id,
          scheduled_value_snapshot: c.sv,
          billed_pct_this_app: Math.round((c.newPct - c.priorPct) * 100) / 100,
          billed_amount_this_app: Math.round(c.thisAppAmount * 100) / 100,
        }));
      if (lineRows.length > 0) {
        const { error: plErr } = await supabase.from("billing_schedule_pay_app_lines").insert(lineRows);
        if (plErr) throw plErr;
      }

      // 3. Create linked SC invoice (amount = gross this billing; retainage captured separately)
      const { data: latest } = await supabase
        .from("invoices").select("id").order("id", { ascending: false }).limit(1);
      const lastNum = Math.max(latest?.length ? parseInt(latest[0].id, 10) : 0, 9999);
      const nextId = String(lastNum + 1).padStart(5, "0");

      const jobNum = proposal.call_log?.display_job_number || "";
      const jobName = proposal.call_log?.job_name || proposal.customer || "";
      const { data: inv, error: invErr } = await supabase
        .from("invoices")
        .insert([{
          id: nextId,
          job_id: jobNum,
          job_name: jobName,
          status: "New",
          amount: Math.round(grossThisBilling * 100) / 100,
          discount: 0,
          proposal_id: proposal.id,
          description: `Pay App #${nextAppNumber} (${periodFrom} to ${periodTo})`,
          retainage_pct: retainagePct,
          retainage_amount: Math.round(retentionThisPeriod * 100) / 100,
        }])
        .select()
        .single();
      if (invErr) throw invErr;

      // Invoice lines (one per billed SOV line)
      const invLineRows = computed
        .filter(c => c.thisAppAmount > 0)
        .map(c => ({
          invoice_id: inv.id,
          billing_schedule_line_id: c.line.id,
          billing_pct: Math.round((c.newPct - c.priorPct) * 100) / 100,
          amount: Math.round(c.thisAppAmount * 100) / 100,
          description: c.line.description,
        }));
      if (invLineRows.length > 0) {
        const { error: ilErr } = await supabase.from("invoice_lines").insert(invLineRows);
        if (ilErr) throw ilErr;
      }

      // 4. Link invoice → pay app
      await supabase.from("billing_schedule_pay_apps")
        .update({ invoice_id: inv.id })
        .eq("id", payApp.id);

      // 5. Generate filled PDF if we have a template
      if (template?.pdf_url) {
        try {
          const resp = await fetch(template.pdf_url);
          const templateBytes = await resp.arrayBuffer();
          // Contract Summary (derived from SOV lines on the schedule)
          const baseLines = lines.filter(l => !l.is_change_order);
          const coLines = lines.filter(l => l.is_change_order).sort((a, b) => (a.co_number || 0) - (b.co_number || 0));
          const originalSubcontract = baseLines.reduce((s, l) => s + (parseFloat(l.scheduled_value) || 0), 0);
          const approvedChangesTotal = coLines.reduce((s, l) => s + (parseFloat(l.scheduled_value) || 0), 0);
          const coFields = {};
          for (let i = 0; i < 5; i++) {
            const amt = coLines[i]?.scheduled_value;
            coFields[`co_${i + 1}`] = amt ? fmt$(amt) : "";
          }

          const tc = tenantConfig || {};
          const addrLine = [tc.address, [tc.city, tc.state].filter(Boolean).join(" "), tc.zip].filter(Boolean).join(", ").trim();
          const fromInfo = [tc.company_name, addrLine, tc.phone].filter(Boolean).join("\n");

          const fieldValues = {
            from_info: fromInfo,
            subcontractor_job_no: jobNumber || "",
            invoice_number: nextId,
            invoice_date: todayISO(),
            invoice_attached_yes: "X",
            original_subcontract: fmt$(originalSubcontract),
            approved_changes_total: approvedChangesTotal > 0 ? fmt$(approvedChangesTotal) : "",
            total_revised_subcontract: fmt$(originalSubcontract + approvedChangesTotal),
            ...coFields,
            type_of_work: typeOfWork,
            period_from: periodFrom,
            period_to: periodTo,
            gross_completed_to_date: fmt$(grossCompletedToDate),
            previous_billings_to_date: fmt$(previousBillings),
            gross_this_billing: fmt$(grossThisBilling),
            retention_this_period: fmt$(retentionThisPeriod),
            current_payment_due: fmt$(currentPaymentDue),
          };
          const filledBytes = await fillPayAppPdf({
            templateBytes,
            fieldValues,
            fieldMap: template.field_mapping || DEFAULT_DA_BUILDERS_JOB_FIELD_MAP,
          });
          const path = `${proposal.id}/pay-app-${nextAppNumber}-${Date.now()}.pdf`;
          const { error: upErr } = await supabase.storage
            .from("job-attachments")
            .upload(path, filledBytes, { contentType: "application/pdf" });
          if (upErr) throw upErr;
          const { data: urlData } = supabase.storage.from("job-attachments").getPublicUrl(path);
          await supabase.from("billing_schedule_pay_apps")
            .update({ pdf_url: urlData.publicUrl })
            .eq("id", payApp.id);
        } catch (pdfErr) {
          // PDF failure shouldn't block the pay app + invoice creation
          console.error("PDF fill failed:", pdfErr);
          alert("Pay app + invoice saved, but PDF generation failed: " + (pdfErr.message || pdfErr));
        }
      }

      setSaving(false);
      onCreated?.(payApp.id);
    } catch (e) {
      setSaving(false);
      setError(e.message || String(e));
    }
  }

  const card = { background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: 20 };
  const labelStyle = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.display, marginBottom: 4 };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 999, overflowY: "auto", padding: "40px 20px" }} onClick={onClose}>
      <div style={{ ...card, width: "100%", maxWidth: 960 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            New Pay App
            {priorApps.length > 0 && (
              <span style={{ color: C.textFaint, marginLeft: 10, fontSize: 14 }}>#{(priorApps[priorApps.length - 1]?.app_number || 0) + 1}</span>
            )}
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.textFaint, lineHeight: 1 }}>×</button>
        </div>

        {loading ? (
          <div style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui }}>Loading…</div>
        ) : (
          <>
            {/* Meta inputs */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: 12, marginBottom: 16 }}>
              <div>
                <div style={labelStyle}>Period From</div>
                <input type="date" value={periodFrom} onChange={e => setPeriodFrom(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <div style={labelStyle}>Period To</div>
                <input type="date" value={periodTo} onChange={e => setPeriodTo(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <div style={labelStyle}>Type of Work</div>
                <input type="text" value={typeOfWork} onChange={e => setTypeOfWork(e.target.value)} placeholder="e.g. Polished Concrete" style={inputStyle} />
              </div>
            </div>

            {/* Template status */}
            <div style={{ background: C.dark, border: `1px solid ${C.borderStrong}`, borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 12, fontFamily: F.ui, color: template ? C.teal : C.amber }}>
              {template
                ? <>Pay app template: <b>{template.label || "untitled"}</b> <span style={{ color: "rgba(255,255,255,0.55)" }}>({template.scope})</span></>
                : <>No pay app template set for this customer. Invoice + record will be saved; PDF won't be generated.</>}
            </div>

            {/* Lines table */}
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 110px 110px 110px 110px", background: C.dark, padding: "8px 12px", gap: 10 }}>
                {["Description", "Scheduled", "Prior %", "% To Date", "This App $", "Remaining"].map((h, i) => (
                  <div key={i} style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.5)", fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase", textAlign: i === 0 ? "left" : "right" }}>{h}</div>
                ))}
              </div>
              {computed.map(c => {
                const remaining = Math.max(0, c.sv - c.newAmount);
                return (
                  <div key={c.line.id} style={{ display: "grid", gridTemplateColumns: "1fr 110px 110px 110px 110px 110px", padding: "8px 12px", gap: 10, borderTop: `1px solid ${C.border}`, alignItems: "center", background: C.linenLight }}>
                    <div style={{ fontSize: 12.5, fontFamily: F.ui, color: C.textBody }}>
                      {c.line.line_code ? <span style={{ color: C.textFaint, marginRight: 6 }}>{c.line.line_code}</span> : null}
                      {c.line.description}
                      {c.line.is_change_order && <span style={{ background: C.dark, color: C.teal, fontSize: 9.5, padding: "1px 6px", borderRadius: 4, marginLeft: 6, fontFamily: F.display, letterSpacing: "0.05em" }}>CO{c.line.co_number ?? ""}</span>}
                    </div>
                    <div style={{ fontSize: 12.5, fontFamily: F.ui, color: C.textBody, textAlign: "right" }}>{fmt$(c.sv)}</div>
                    <div style={{ fontSize: 12.5, fontFamily: F.ui, color: C.textFaint, textAlign: "right" }}>{c.priorPct.toFixed(1)}%</div>
                    <div>
                      <input
                        type="text" inputMode="decimal"
                        value={pctToDate[c.line.id] ?? ""}
                        onChange={e => {
                          const v = e.target.value;
                          if (v === "" || /^[0-9]*\.?[0-9]*$/.test(v)) {
                            setPctToDate(prev => ({ ...prev, [c.line.id]: v }));
                          }
                        }}
                        placeholder="%"
                        style={{ ...inputStyle, textAlign: "right", padding: "4px 8px", fontSize: 12.5 }}
                      />
                    </div>
                    <div style={{ fontSize: 12.5, fontFamily: F.ui, color: C.textHead, textAlign: "right", fontWeight: 700 }}>{fmt$(c.thisAppAmount)}</div>
                    <div style={{ fontSize: 12.5, fontFamily: F.ui, color: C.textFaint, textAlign: "right" }}>{fmt$(remaining)}</div>
                  </div>
                );
              })}
            </div>

            {/* Totals */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
              <div style={{ background: C.linen, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                <Row label="Gross Completed to Date (Line 4)" value={fmt$(grossCompletedToDate)} />
                <Row label="Less Previous Billings (Line 5)" value={fmt$(previousBillings)} />
                <Row label="Gross This Billing (Line 6)" value={fmt$(grossThisBilling)} bold />
              </div>
              <div style={{ background: C.linen, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                <Row label={`Retention (${retainagePct}%) (Line 7)`} value={fmt$(retentionThisPeriod)} />
                <Row label="Current Payment Due (Line 8)" value={fmt$(currentPaymentDue)} bold big />
              </div>
            </div>

            {error && (
              <div style={{ background: "#3a1a1a", border: `1px solid #7a2a2a`, color: "#ffbcbc", borderRadius: 6, padding: "8px 12px", fontSize: 12, fontFamily: F.ui, marginBottom: 12 }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <Btn sz="sm" v="ghost" onClick={onClose} disabled={saving}>Cancel</Btn>
              <Btn sz="sm" onClick={handleCreate} disabled={saving}>
                {saving ? "Creating…" : "Create Pay App + Invoice"}
              </Btn>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, bold, big }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
      <span style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: big ? 18 : 14, color: C.textHead, fontFamily: F.display, fontWeight: bold ? 800 : 600 }}>{value}</span>
    </div>
  );
}
