import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { C, F } from "../lib/tokens";
import { fmt$ } from "../lib/utils";
import { fillPayAppPdf, DEFAULT_DA_BUILDERS_JOB_FIELD_MAP } from "../lib/payAppPdf";
import Btn from "./Btn";

const inputStyle = {
  padding: "8px 12px", borderRadius: 6, border: `1.5px solid ${C.borderStrong}`,
  background: C.linenDeep, color: C.textBody, fontSize: 13, fontFamily: F.ui,
  WebkitAppearance: "none", outline: "none", width: "100%",
};

const labelStyle = {
  fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em",
  color: C.textFaint, fontFamily: F.display, marginBottom: 4,
};

function applyTemplateVars(tmpl, vars) {
  if (!tmpl) return "";
  return Object.keys(vars).reduce((acc, k) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), vars[k] ?? ""), tmpl);
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function PayAppDetailModal({ payAppId, schedule, proposal, onClose, onChanged }) {
  const [step, setStep] = useState("view"); // 'view' | 'send'
  const [loading, setLoading] = useState(true);
  const [payApp, setPayApp] = useState(null);
  const [payAppLines, setPayAppLines] = useState([]);
  const [invoice, setInvoice] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [jobNumber, setJobNumber] = useState(null);
  const [tenantConfig, setTenantConfig] = useState(null);
  const [template, setTemplate] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState(null);

  // Send state
  const [recipientEmail, setRecipientEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [
      { data: pa },
      { data: paLines },
      { data: cl },
      { data: tc },
    ] = await Promise.all([
      supabase.from("billing_schedule_pay_apps").select("*").eq("id", payAppId).single(),
      supabase.from("billing_schedule_pay_app_lines")
        .select("*, billing_schedule_line:billing_schedule_line_id(line_code, description, scheduled_value, is_change_order, co_number, ordinal)")
        .eq("pay_app_id", payAppId),
      supabase.from("call_log").select("customer_id, job_number, subcontractor_job_no, customers(*)").eq("id", proposal.call_log_id).maybeSingle(),
      supabase.from("tenant_config").select("*").single(),
    ]);
    setPayApp(pa);
    setPayAppLines((paLines || []).sort((a, b) => (a.billing_schedule_line?.ordinal ?? 0) - (b.billing_schedule_line?.ordinal ?? 0)));
    const cust = cl?.customers;
    setCustomer(cust);
    setJobNumber(cl?.subcontractor_job_no || cl?.job_number || null);
    setTenantConfig(tc);

    if (pa?.invoice_id) {
      const { data: inv } = await supabase.from("invoices").select("*").eq("id", pa.invoice_id).maybeSingle();
      setInvoice(inv);
    }

    // Match template lookup from NewPayAppModal
    if (cust?.id) {
      const { data: tmpls } = await supabase
        .from("customer_pay_app_templates")
        .select("*")
        .eq("customer_id", cust.id)
        .order("is_default", { ascending: false });
      const jobTmpl = (tmpls || []).find(t => t.scope === "job" && t.proposal_id === proposal.id);
      const custTmpl = (tmpls || []).find(t => t.scope === "customer");
      setTemplate(jobTmpl || custTmpl || null);
    }

    setLoading(false);
  }, [payAppId, proposal.call_log_id, proposal.id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function regeneratePdf() {
    if (!template?.pdf_url) { alert("Upload a pay app template for this customer first."); return; }
    setRegenerating(true);
    setError(null);
    try {
      const resp = await fetch(template.pdf_url);
      const templateBytes = await resp.arrayBuffer();
      // Fetch latest in case user just edited it on Call Log. subcontractor_job_no wins,
      // fall back to job_number (archive imports store customer's internal # there).
      const { data: freshCl } = await supabase
        .from("call_log")
        .select("subcontractor_job_no, job_number")
        .eq("id", proposal.call_log_id)
        .maybeSingle();
      const freshJobNo = freshCl?.subcontractor_job_no || freshCl?.job_number || jobNumber || "";
      if (freshJobNo && freshJobNo !== jobNumber) setJobNumber(freshJobNo);

      const tc = tenantConfig || {};
      const addrLine = [tc.address, [tc.city, tc.state].filter(Boolean).join(" "), tc.zip].filter(Boolean).join(", ").trim();
      const fromInfo = [tc.company_name, addrLine, tc.phone].filter(Boolean).join("\n");

      const fieldValues = {
        from_info: fromInfo,
        subcontractor_job_no: freshJobNo,
        invoice_number: invoice?.id || "",
        invoice_date: new Date().toISOString().slice(0, 10),
        invoice_attached_yes: "X",
        type_of_work: payApp.type_of_work || "",
        period_from: payApp.period_from || "",
        period_to: payApp.period_to || "",
        gross_completed_to_date: fmt$((parseFloat(payApp.this_app_amount) || 0) + payAppLines.reduce((s, pl) => {
          // Previous billings for each line = scheduled_value × (prior_pct / 100)
          // Already stored as billed_amount_this_app; grossCompleted = sum of all past + this.
          // Simplest: recompute from pay app row's snapshot values since they were saved on create.
          return s;
        }, 0)),
        previous_billings_to_date: fmt$(0), // simplified — see note below
        gross_this_billing: fmt$(parseFloat(payApp.this_app_amount) || 0),
        retention_this_period: fmt$(parseFloat(payApp.retainage_withheld) || 0),
        current_payment_due: fmt$(parseFloat(payApp.current_payment_due) || 0),
      };
      // Pull gross_completed + previous_billings from the pay_apps rows prior to this one.
      const { data: priorApps } = await supabase
        .from("billing_schedule_pay_apps")
        .select("this_app_amount")
        .eq("billing_schedule_id", schedule.id)
        .lt("app_number", payApp.app_number);
      const priorBillings = (priorApps || []).reduce((s, a) => s + (parseFloat(a.this_app_amount) || 0), 0);
      fieldValues.previous_billings_to_date = fmt$(priorBillings);
      fieldValues.gross_completed_to_date = fmt$(priorBillings + (parseFloat(payApp.this_app_amount) || 0));

      // Contract Summary block — derive from SOV lines on the schedule
      const { data: sovLines } = await supabase
        .from("billing_schedule_lines")
        .select("scheduled_value, is_change_order, co_number")
        .eq("billing_schedule_id", schedule.id)
        .order("co_number", { ascending: true });
      const baseLines = (sovLines || []).filter(l => !l.is_change_order);
      const coLines = (sovLines || []).filter(l => l.is_change_order).sort((a, b) => (a.co_number || 0) - (b.co_number || 0));
      const originalSubcontract = baseLines.reduce((s, l) => s + (parseFloat(l.scheduled_value) || 0), 0);
      const approvedChangesTotal = coLines.reduce((s, l) => s + (parseFloat(l.scheduled_value) || 0), 0);
      fieldValues.original_subcontract = fmt$(originalSubcontract);
      fieldValues.approved_changes_total = approvedChangesTotal > 0 ? fmt$(approvedChangesTotal) : "";
      fieldValues.total_revised_subcontract = fmt$(originalSubcontract + approvedChangesTotal);
      for (let i = 0; i < 5; i++) {
        const amt = coLines[i]?.scheduled_value;
        fieldValues[`co_${i + 1}`] = amt ? fmt$(amt) : "";
      }

      const filledBytes = await fillPayAppPdf({
        templateBytes,
        fieldValues,
        fieldMap: template.field_mapping || DEFAULT_DA_BUILDERS_JOB_FIELD_MAP,
      });
      const path = `${proposal.id}/pay-app-${payApp.app_number}-${Date.now()}.pdf`;
      const { error: upErr } = await supabase.storage
        .from("job-attachments")
        .upload(path, filledBytes, { contentType: "application/pdf" });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from("job-attachments").getPublicUrl(path);
      await supabase.from("billing_schedule_pay_apps").update({ pdf_url: urlData.publicUrl }).eq("id", payApp.id);
      setPayApp(prev => ({ ...prev, pdf_url: urlData.publicUrl }));
      onChanged?.();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setRegenerating(false);
    }
  }

  function openSendStep() {
    if (!payApp?.pdf_url) { alert("Generate the pay app PDF first — this customer's email expects it attached."); return; }
    if (!invoice) { alert("No linked invoice on this pay app."); return; }
    const billingEmail = customer?.billing_email || customer?.email || "";
    setRecipientEmail(billingEmail);
    setSubject(`Pay App #${payApp.app_number} — ${proposal.call_log?.job_name || proposal.customer || ""}`);
    const vars = {
      app_number: payApp.app_number,
      period: `${formatDate(payApp.period_from)} to ${formatDate(payApp.period_to)}`,
      job_name: proposal.call_log?.job_name || proposal.customer || "",
      amount: fmt$(invoice.amount),
      invoice_number: invoice.id,
    };
    setBody(applyTemplateVars(tenantConfig?.default_pay_app_intro || "", vars));
    setSendError(null);
    setStep("send");
  }

  async function handleSend() {
    if (!recipientEmail) { setSendError("Recipient email is required."); return; }
    setSending(true);
    setSendError(null);
    try {
      // We need the invoice PDF too. Generate it on-the-fly if not already stored.
      // For MVP: try to fetch if pdf_url is on the invoice row; if not, generate via invoicePdf util.
      let invoicePdfUrl = invoice.pdf_url || null;
      if (!invoicePdfUrl) {
        const { generateInvoicePdf } = await import("../lib/invoicePdf");
        const { data: lines } = await supabase
          .from("invoice_lines")
          .select("*, proposal_wtc:proposal_wtc_id(*, work_types(name)), billing_schedule_line:billing_schedule_line_id(line_code, description, scheduled_value)")
          .eq("invoice_id", invoice.id);
        const result = await generateInvoicePdf({
          invoice,
          lines: lines || [],
          tenantConfig,
          callLog: { ...proposal.call_log, subcontractor_job_no: jobNumber },
          customer,
        });
        invoicePdfUrl = result.pdfUrl;
        await supabase.from("invoices").update({ pdf_url: invoicePdfUrl }).eq("id", invoice.id);
      }

      const { data: { user } } = await supabase.auth.getUser();
      const senderEmail = user?.email || tenantConfig?.email || "noreply@salescommand.app";
      const { data, error: fnError } = await supabase.functions.invoke("send-pay-app", {
        body: {
          payAppId: payApp.id,
          invoiceId: invoice.id,
          recipientEmail,
          recipientName: customer?.billing_name || customer?.name || "Customer",
          subject,
          body,
          payAppPdfUrl: payApp.pdf_url,
          invoicePdfUrl,
          senderEmail,
        },
      });
      if (fnError) throw new Error(fnError.message || "Send failed");
      if (data?.error) throw new Error(data.error);

      setSending(false);
      onChanged?.();
      onClose();
    } catch (e) {
      setSending(false);
      setSendError(e.message || String(e));
    }
  }

  const card = { background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: 20 };

  const statusBadge = (() => {
    const s = payApp?.status || "draft";
    if (s === "submitted") return { label: "Submitted", color: C.teal };
    if (s === "paid") return { label: "Paid", color: C.green };
    return { label: "Draft", color: C.amber };
  })();

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 999, overflowY: "auto", padding: "40px 20px" }} onClick={onClose}>
      <div style={{ ...card, width: "100%", maxWidth: 1100 }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              Pay App #{payApp?.app_number ?? "…"}
            </h2>
            {payApp && (
              <span style={{ background: C.dark, color: statusBadge.color, fontSize: 10.5, fontWeight: 700, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase", padding: "3px 10px", borderRadius: 6 }}>
                {statusBadge.label}
              </span>
            )}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.textFaint, lineHeight: 1 }}>×</button>
        </div>

        {loading ? (
          <div style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui }}>Loading…</div>
        ) : step === "view" ? (
          <>
            {/* Meta row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
              <MetaCard label="Period" value={`${formatDate(payApp.period_from)} – ${formatDate(payApp.period_to)}`} />
              <MetaCard label="This App" value={fmt$(payApp.this_app_amount)} />
              <MetaCard label={`Retention (${payApp.retainage_pct_snapshot}%)`} value={fmt$(payApp.retainage_withheld)} faint />
              <MetaCard label="Payment Due" value={fmt$(payApp.current_payment_due)} bold />
            </div>

            {/* Two-column layout: left = lines + invoice, right = PDF preview */}
            <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 16, marginBottom: 16 }}>
              {/* Left column */}
              <div>
                {/* SOV line breakdown */}
                <div style={{ marginBottom: 16 }}>
                  <div style={labelStyle}>Line Breakdown</div>
                  <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 70px 100px", background: C.dark, padding: "7px 12px", gap: 8 }}>
                      {["Description", "Scheduled", "This App %", "This App $"].map((h, i) => (
                        <div key={i} style={{ fontSize: 9.5, fontWeight: 700, color: "rgba(255,255,255,0.5)", fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase", textAlign: i === 0 ? "left" : "right" }}>{h}</div>
                      ))}
                    </div>
                    {payAppLines.map(pl => {
                      const bsl = pl.billing_schedule_line;
                      return (
                        <div key={pl.id} style={{ display: "grid", gridTemplateColumns: "1fr 90px 70px 100px", padding: "7px 12px", gap: 8, borderTop: `1px solid ${C.border}`, alignItems: "center", background: C.linenLight, fontSize: 12, fontFamily: F.ui }}>
                          <div style={{ color: C.textBody }}>
                            {bsl?.line_code ? <span style={{ color: C.textFaint, marginRight: 5 }}>{bsl.line_code}</span> : null}
                            {bsl?.description || "—"}
                            {bsl?.is_change_order && <span style={{ background: C.dark, color: C.teal, fontSize: 9, padding: "1px 5px", borderRadius: 4, marginLeft: 5, fontFamily: F.display }}>CO{bsl.co_number ?? ""}</span>}
                          </div>
                          <div style={{ textAlign: "right", color: C.textBody }}>{fmt$(pl.scheduled_value_snapshot)}</div>
                          <div style={{ textAlign: "right", color: C.textFaint }}>{parseFloat(pl.billed_pct_this_app).toFixed(1)}%</div>
                          <div style={{ textAlign: "right", color: C.textHead, fontWeight: 700 }}>{fmt$(pl.billed_amount_this_app)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Linked invoice summary */}
                <div>
                  <div style={labelStyle}>Linked Sales Command Invoice</div>
                  {invoice ? (
                    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: C.linen, padding: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                        <span style={{ background: C.dark, color: C.teal, fontWeight: 800, fontSize: 12, fontFamily: F.display, padding: "3px 10px", borderRadius: 6, letterSpacing: "0.04em" }}>#{invoice.id}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: C.textFaint, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase" }}>{invoice.status}</span>
                      </div>
                      <div style={{ fontSize: 13, color: C.textBody, fontFamily: F.ui, marginBottom: 3 }}>{invoice.description || "—"}</div>
                      <div style={{ display: "flex", gap: 18, fontSize: 12, color: C.textFaint, fontFamily: F.ui }}>
                        <span>Amount: <b style={{ color: C.textHead }}>{fmt$(invoice.amount)}</b></span>
                        {invoice.retainage_amount > 0 && <span>Retainage held: <b style={{ color: C.textHead }}>{fmt$(invoice.retainage_amount)}</b></span>}
                        {invoice.sent_at && <span>Sent: {new Date(invoice.sent_at).toLocaleDateString()}</span>}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui, padding: 10, background: C.linen, borderRadius: 8, border: `1px solid ${C.border}` }}>No linked invoice</div>
                  )}
                </div>
              </div>

              {/* Right column: PDF preview */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <div style={labelStyle}>Filled Pay App PDF</div>
                  {payApp.pdf_url && <a href={payApp.pdf_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10.5, color: C.teal, fontWeight: 700, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", textDecoration: "none" }}>Open ↗</a>}
                </div>
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", background: C.linenDeep, height: 520 }}>
                  {payApp.pdf_url ? (
                    <iframe src={payApp.pdf_url} title="Pay App PDF" style={{ width: "100%", height: "100%", border: "none" }} />
                  ) : (
                    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10, padding: 20, textAlign: "center" }}>
                      <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui }}>
                        {template ? "No PDF generated yet." : `No pay app template set for ${customer?.name || "this customer"}. Upload one in Customers → ${customer?.name || ""} → Pay App Templates.`}
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ marginTop: 6, display: "flex", justifyContent: "flex-end" }}>
                  <Btn sz="sm" v={payApp.pdf_url ? "ghost" : "primary"} onClick={regeneratePdf} disabled={!template || regenerating}>
                    {regenerating ? "Generating…" : payApp.pdf_url ? "Regenerate PDF" : "Generate PDF"}
                  </Btn>
                </div>
              </div>
            </div>

            {error && (
              <div style={{ background: "#3a1a1a", border: `1px solid #7a2a2a`, color: "#ffbcbc", borderRadius: 6, padding: "8px 12px", fontSize: 12, fontFamily: F.ui, marginBottom: 12 }}>{error}</div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
              <Btn sz="sm" v="ghost" onClick={onClose}>Close</Btn>
              <Btn sz="sm" onClick={openSendStep} disabled={!payApp.pdf_url || !invoice || payApp.status === "submitted" || payApp.status === "paid"}>
                {payApp.status === "submitted" ? "Already Sent" : payApp.status === "paid" ? "Paid" : "Send Pay App"}
              </Btn>
            </div>
          </>
        ) : (
          /* step === "send" */
          <>
            <div style={{ marginBottom: 14, fontSize: 12, color: C.textMuted, fontFamily: F.ui }}>
              One email will go to the recipient with both the filled pay app PDF and the Sales Command invoice PDF attached.
              QuickBooks will sync the invoice automatically on success.
            </div>

            <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
              <div>
                <div style={labelStyle}>Recipient Email</div>
                <input type="email" value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <div style={labelStyle}>Subject</div>
                <input type="text" value={subject} onChange={e => setSubject(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <div style={labelStyle}>Body</div>
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  rows={10}
                  style={{ ...inputStyle, fontFamily: F.ui, lineHeight: 1.5, resize: "vertical" }}
                />
              </div>
            </div>

            <div style={{ background: C.dark, border: `1px solid ${C.borderStrong}`, borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 12, fontFamily: F.ui, color: C.teal }}>
              Attaching: <b>Pay App #{payApp?.app_number}.pdf</b> + <b>Invoice #{invoice?.id}.pdf</b>
            </div>

            {sendError && (
              <div style={{ background: "#3a1a1a", border: `1px solid #7a2a2a`, color: "#ffbcbc", borderRadius: 6, padding: "8px 12px", fontSize: 12, fontFamily: F.ui, marginBottom: 12 }}>{sendError}</div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
              <Btn sz="sm" v="ghost" onClick={() => setStep("view")} disabled={sending}>← Back</Btn>
              <Btn sz="sm" onClick={handleSend} disabled={sending}>
                {sending ? "Sending…" : "Send"}
              </Btn>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MetaCard({ label, value, bold, faint }) {
  return (
    <div style={{ background: C.linen, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10 }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: C.textFaint, fontFamily: F.display, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: bold ? 16 : 14, fontWeight: bold ? 800 : 600, color: faint ? C.textMuted : C.textHead, fontFamily: F.display }}>{value}</div>
    </div>
  );
}
