import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { C, F } from "../lib/tokens";
import { fmt$ } from "../lib/utils";
import Btn from "./Btn";
import PayAppCheatSheet from "./PayAppCheatSheet";

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
  const [step, setStep] = useState("view"); // 'view' | 'send' | 'sent'
  const [loading, setLoading] = useState(true);
  const [payApp, setPayApp] = useState(null);
  const [payAppLines, setPayAppLines] = useState([]);
  const [invoice, setInvoice] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [jobNumber, setJobNumber] = useState(null);
  const [tenantConfig, setTenantConfig] = useState(null);
  const [template, setTemplate] = useState(null);
  const [error, setError] = useState(null);
  const [cheatData, setCheatData] = useState(null);

  // Send state
  const [recipientEmail, setRecipientEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingWaiver, setUploadingWaiver] = useState(false);
  const [editPcts, setEditPcts] = useState({});
  const [savingLines, setSavingLines] = useState(false);
  const [contractDocs, setContractDocs] = useState([]);

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
    const sorted = (paLines || []).sort((a, b) => (a.billing_schedule_line?.ordinal ?? 0) - (b.billing_schedule_line?.ordinal ?? 0));
    setPayAppLines(sorted);
    const initPcts = {};
    for (const pl of sorted) initPcts[pl.id] = String(parseFloat(pl.billed_pct_this_app) || 0);
    setEditPcts(initPcts);
    const cust = cl?.customers;
    setJobNumber(cl?.subcontractor_job_no || cl?.job_number || null);
    setTenantConfig(tc);

    if (cust?.id) {
      const { data: bc } = await supabase
        .from("customer_contacts")
        .select("name, email, phone")
        .eq("customer_id", cust.id)
        .eq("role", "Billing Contact")
        .maybeSingle();
      if (bc) {
        cust.billing_name = bc.name || cust.billing_name;
        cust.billing_email = bc.email || cust.billing_email;
        cust.billing_phone = bc.phone || cust.billing_phone;
      }
    }
    setCustomer(cust);

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

    // Compute G702 cheat sheet values
    const { data: priorApps } = await supabase
      .from("billing_schedule_pay_apps")
      .select("this_app_amount")
      .eq("billing_schedule_id", schedule.id)
      .lt("app_number", pa.app_number);
    const priorBillings = (priorApps || []).reduce((s, a) => s + (parseFloat(a.this_app_amount) || 0), 0);

    const { data: sovLines } = await supabase
      .from("billing_schedule_lines")
      .select("scheduled_value, is_change_order, co_number, description")
      .eq("billing_schedule_id", schedule.id)
      .order("co_number", { ascending: true });
    const baseLines = (sovLines || []).filter(l => !l.is_change_order);
    const coLines = (sovLines || []).filter(l => l.is_change_order).sort((a, b) => (a.co_number || 0) - (b.co_number || 0));
    const originalContract = baseLines.reduce((s, l) => s + (parseFloat(l.scheduled_value) || 0), 0);
    const changeOrders = coLines.reduce((s, l) => s + (parseFloat(l.scheduled_value) || 0), 0);
    const contractToDate = originalContract + changeOrders;
    const thisApp = parseFloat(pa.this_app_amount) || 0;
    const completedToDate = priorBillings + thisApp;
    const retainagePct = parseFloat(pa.retainage_pct_snapshot) || 0;
    const retainageAmount = parseFloat(pa.retainage_withheld) || 0;
    const lessRetention = completedToDate - retainageAmount;
    // Previous certs = previous gross billings minus cumulative prior retainage
    // Simplified: use priorBillings minus prior retainage. Since we don't store prior retainage
    // cumulatively, approximate: previous payment due = sum of prior apps' current_payment_due
    const { data: priorPayments } = await supabase
      .from("billing_schedule_pay_apps")
      .select("current_payment_due")
      .eq("billing_schedule_id", schedule.id)
      .lt("app_number", pa.app_number);
    const previousCerts = (priorPayments || []).reduce((s, a) => s + (parseFloat(a.current_payment_due) || 0), 0);

    setCheatData({
      originalContract,
      changeOrders,
      contractToDate,
      completedToDate,
      retainagePct,
      retainageAmount,
      lessRetention,
      previousApps: previousCerts,
      currentPaymentDue: parseFloat(pa.current_payment_due) || 0,
      coBreakdown: coLines.map(l => ({ number: l.co_number, description: l.description, amount: parseFloat(l.scheduled_value) || 0 })),
    });

    // Load contract docs from billing schedule
    const { data: schRow } = await supabase.from("billing_schedule").select("contract_pdf_url, contract_pdf_urls").eq("id", schedule.id).maybeSingle();
    if (schRow) {
      const docs = Array.isArray(schRow.contract_pdf_urls) && schRow.contract_pdf_urls.length ? schRow.contract_pdf_urls : schRow.contract_pdf_url ? [schRow.contract_pdf_url] : [];
      setContractDocs(docs);
    }

    setLoading(false);
  }, [payAppId, proposal.call_log_id, proposal.id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function handleUploadCompleted(file) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `pay-app-completed/${payAppId}/${Date.now()}-${cleanName}`;
      const { error: upErr } = await supabase.storage.from("job-attachments").upload(path, file, { contentType: file.type || "application/octet-stream" });
      if (upErr) throw new Error(upErr.message);
      const { data: pub } = supabase.storage.from("job-attachments").getPublicUrl(path);
      const { error: updErr } = await supabase
        .from("billing_schedule_pay_apps")
        .update({ pdf_url: pub?.publicUrl })
        .eq("id", payAppId);
      if (updErr) throw new Error(updErr.message);
      setPayApp(prev => ({ ...prev, pdf_url: pub?.publicUrl }));
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleUploadWaiver(file) {
    if (!file) return;
    setUploadingWaiver(true);
    setError(null);
    try {
      const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `pay-app-waivers/${payAppId}/${Date.now()}-${cleanName}`;
      const { error: upErr } = await supabase.storage.from("job-attachments").upload(path, file, { contentType: file.type || "application/octet-stream" });
      if (upErr) throw new Error(upErr.message);
      const { data: pub } = supabase.storage.from("job-attachments").getPublicUrl(path);
      const { error: updErr } = await supabase
        .from("billing_schedule_pay_apps")
        .update({ release_waiver_url: pub?.publicUrl })
        .eq("id", payAppId);
      if (updErr) throw new Error(updErr.message);
      setPayApp(prev => ({ ...prev, release_waiver_url: pub?.publicUrl }));
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setUploadingWaiver(false);
    }
  }

  function computeEditedLines() {
    const retPct = parseFloat(payApp?.retainage_pct_snapshot) || 0;
    const updated = payAppLines.map(pl => {
      const sv = parseFloat(pl.scheduled_value_snapshot) || 0;
      const newPct = parseFloat(editPcts[pl.id]) || 0;
      const amt = Math.round(sv * (newPct / 100) * 100) / 100;
      return { ...pl, billed_pct_this_app: newPct, billed_amount_this_app: amt };
    });
    const gross = updated.reduce((s, l) => s + l.billed_amount_this_app, 0);
    const ret = Math.round(gross * (retPct / 100) * 100) / 100;
    return { updated, gross, ret, due: Math.round((gross - ret) * 100) / 100 };
  }

  async function handleSaveLines() {
    setSavingLines(true);
    setError(null);
    try {
      const { updated, gross, ret, due } = computeEditedLines();
      for (const l of updated) {
        await supabase.from("billing_schedule_pay_app_lines").update({
          billed_pct_this_app: l.billed_pct_this_app,
          billed_amount_this_app: l.billed_amount_this_app,
        }).eq("id", l.id);
      }
      await supabase.from("billing_schedule_pay_apps").update({
        this_app_amount: Math.round(gross * 100) / 100,
        retainage_withheld: ret,
        current_payment_due: due,
      }).eq("id", payAppId);
      if (payApp?.invoice_id) {
        await supabase.from("invoices").update({
          amount: Math.round(gross * 100) / 100,
          retention_amount: ret,
        }).eq("id", payApp.invoice_id);
      }
      await loadAll();
      onChanged?.();
    } catch (e) {
      setError(e.message || "Failed to save line edits");
    } finally {
      setSavingLines(false);
    }
  }

  async function handleDeletePayApp() {
    if (invoice?.qb_invoice_id) {
      alert(`Invoice #${invoice.id} is synced to QuickBooks. Void the invoice first, then delete the pay app.`);
      return;
    }
    const msg = payApp?.invoice_id
      ? `Delete Pay App #${payApp.app_number} and its linked Invoice #${payApp.invoice_id}? The pay app is permanently removed; the invoice is soft-deleted. This cannot be undone.`
      : `Delete Pay App #${payApp.app_number}? This cannot be undone.`;
    if (!confirm(msg)) return;
    setError(null);
    try {
      if (payApp?.invoice_id) {
        const { error: invErr } = await supabase
          .from("invoices")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", payApp.invoice_id)
          .is("deleted_at", null);
        if (invErr) throw new Error(`Failed to delete invoice: ${invErr.message}`);
      }
      const { error: paErr, count: paCount } = await supabase
        .from("billing_schedule_pay_apps")
        .delete({ count: "exact" })
        .eq("id", payAppId);
      if (paErr) throw new Error(`Failed to delete pay app: ${paErr.message}`);
      if (!paCount) throw new Error("Pay app delete returned 0 rows — likely blocked by RLS.");
      const { count: remaining } = await supabase
        .from("billing_schedule_pay_apps")
        .select("id", { count: "exact", head: true })
        .eq("billing_schedule_id", schedule.id);
      if (!remaining) {
        const { error: schErr } = await supabase
          .from("billing_schedule")
          .update({ status: "draft" })
          .eq("id", schedule.id);
        if (schErr) throw new Error(`Failed to unlock schedule: ${schErr.message}`);
      }
      onChanged?.();
      onClose();
    } catch (e) {
      setError(e.message || "Failed to delete pay app");
    }
  }

  function openSendStep() {
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
          payAppPdfUrl: payApp.pdf_url || null,
          sovPdfUrl: payApp.sov_pdf_url || null,
          releaseWaiverUrl: payApp.release_waiver_url || null,
          invoicePdfUrl,
          senderEmail,
        },
      });
      if (fnError) throw new Error(fnError.message || "Send failed");
      if (data?.error) throw new Error(data.error);

      setSending(false);
      onChanged?.();
      setPayApp(prev => ({ ...prev, status: "submitted", submitted_at: new Date().toISOString() }));
      setStep("sent");
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
            {contractDocs.length > 0 && contractDocs.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10.5, fontWeight: 700, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", color: C.teal, background: C.dark, padding: "4px 12px", borderRadius: 6, textDecoration: "none" }}>
                {contractDocs.length === 1 ? "View Contract" : `Contract ${i + 1}`}
              </a>
            ))}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.textFaint, lineHeight: 1 }}>×</button>
        </div>

        {loading ? (
          <div style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui }}>Loading…</div>
        ) : step === "view" ? (
          <>
            {/* Sent banner */}
            {(payApp.status === "submitted" || payApp.status === "paid") && payApp.submitted_at && (
              <div style={{ background: C.dark, borderRadius: 8, padding: "8px 14px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ color: C.teal, fontSize: 11, fontWeight: 700, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  Sent {new Date(payApp.submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  {payApp.pdf_url && <a href={payApp.pdf_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, fontWeight: 700, color: C.teal, fontFamily: F.display, background: "rgba(48,207,172,0.12)", padding: "3px 10px", borderRadius: 5, textDecoration: "none", letterSpacing: "0.04em", textTransform: "uppercase" }}>Pay App</a>}
                  {payApp.sov_pdf_url && <a href={payApp.sov_pdf_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, fontWeight: 700, color: C.teal, fontFamily: F.display, background: "rgba(48,207,172,0.12)", padding: "3px 10px", borderRadius: 5, textDecoration: "none", letterSpacing: "0.04em", textTransform: "uppercase" }}>SOV</a>}
                  {payApp.release_waiver_url && <a href={payApp.release_waiver_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, fontWeight: 700, color: C.teal, fontFamily: F.display, background: "rgba(48,207,172,0.12)", padding: "3px 10px", borderRadius: 5, textDecoration: "none", letterSpacing: "0.04em", textTransform: "uppercase" }}>Waiver</a>}
                  {invoice?.pdf_url && <a href={invoice.pdf_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, fontWeight: 700, color: C.teal, fontFamily: F.display, background: "rgba(48,207,172,0.12)", padding: "3px 10px", borderRadius: 5, textDecoration: "none", letterSpacing: "0.04em", textTransform: "uppercase" }}>Invoice</a>}
                </div>
              </div>
            )}

            {/* Meta row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
              <MetaCard label="Period" value={`${formatDate(payApp.period_from)} – ${formatDate(payApp.period_to)}`} />
              <MetaCard label="This App" value={fmt$(payApp.this_app_amount)} />
              <MetaCard label={`Retention (${payApp.retainage_pct_snapshot}%)`} value={fmt$(payApp.retainage_withheld)} faint />
              <MetaCard label="Payment Due" value={fmt$(payApp.current_payment_due)} bold />
            </div>

            {/* Two-column layout: left = lines + invoice, right = cheat sheet (draft only) */}
            {(() => {
              const isSent = payApp.status === "submitted" || payApp.status === "paid";
              const isDraft = !isSent;
              const edited = isDraft ? computeEditedLines() : null;
              const lineBreakdown = (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <div style={labelStyle}>Line Breakdown</div>
                    {isDraft && (
                      <Btn sz="sm" onClick={handleSaveLines} disabled={savingLines}>
                        {savingLines ? "Saving..." : "Save Changes"}
                      </Btn>
                    )}
                  </div>
                  <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 70px 100px", background: C.dark, padding: "7px 12px", gap: 8 }}>
                      {["Description", "Scheduled", "This App %", "This App $"].map((h, i) => (
                        <div key={i} style={{ fontSize: 9.5, fontWeight: 700, color: "rgba(255,255,255,0.5)", fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase", textAlign: i === 0 ? "left" : "right" }}>{h}</div>
                      ))}
                    </div>
                    {payAppLines.map(pl => {
                      const bsl = pl.billing_schedule_line;
                      const sv = parseFloat(pl.scheduled_value_snapshot) || 0;
                      const pct = isDraft ? (parseFloat(editPcts[pl.id]) || 0) : parseFloat(pl.billed_pct_this_app);
                      const amt = isDraft ? Math.round(sv * (pct / 100) * 100) / 100 : parseFloat(pl.billed_amount_this_app);
                      return (
                        <div key={pl.id} style={{ display: "grid", gridTemplateColumns: "1fr 90px 70px 100px", padding: "7px 12px", gap: 8, borderTop: `1px solid ${C.border}`, alignItems: "center", background: C.linenLight, fontSize: 12, fontFamily: F.ui }}>
                          <div style={{ color: C.textBody }}>
                            {bsl?.line_code ? <span style={{ color: C.textFaint, marginRight: 5 }}>{bsl.line_code}</span> : null}
                            {bsl?.description || "—"}
                            {bsl?.is_change_order && <span style={{ background: C.dark, color: C.teal, fontSize: 9, padding: "1px 5px", borderRadius: 4, marginLeft: 5, fontFamily: F.display }}>CO{bsl.co_number ?? ""}</span>}
                          </div>
                          <div style={{ textAlign: "right", color: C.textBody }}>{fmt$(sv)}</div>
                          {isDraft ? (
                            <input
                              type="number" step="0.1" min="0" max="100"
                              value={editPcts[pl.id] ?? ""}
                              onChange={e => setEditPcts(prev => ({ ...prev, [pl.id]: e.target.value }))}
                              style={{ ...inputStyle, padding: "4px 6px", fontSize: 11, textAlign: "right", width: 60 }}
                            />
                          ) : (
                            <div style={{ textAlign: "right", color: C.textFaint }}>{pct.toFixed(1)}%</div>
                          )}
                          <div style={{ textAlign: "right", color: C.textHead, fontWeight: 700 }}>{fmt$(amt)}</div>
                        </div>
                      );
                    })}
                    {isDraft && edited && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 70px 100px", padding: "7px 12px", gap: 8, borderTop: `2px solid ${C.borderStrong}`, background: C.linen, fontSize: 12, fontFamily: F.display, fontWeight: 700 }}>
                        <div style={{ color: C.textHead }}>Total This App</div>
                        <div />
                        <div />
                        <div style={{ textAlign: "right", color: C.teal }}>{fmt$(edited.gross)}</div>
                      </div>
                    )}
                  </div>
                </div>
              );
              const invoiceCard = (
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
                        {invoice.retention_amount > 0 && <span>Retainage held: <b style={{ color: C.textHead }}>{fmt$(invoice.retention_amount)}</b></span>}
                        {invoice.sent_at && <span>Sent: {new Date(invoice.sent_at).toLocaleDateString()}</span>}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui, padding: 10, background: C.linen, borderRadius: 8, border: `1px solid ${C.border}` }}>No linked invoice</div>
                  )}
                </div>
              );

              if (isSent) {
                return (
                  <div style={{ marginBottom: 16 }}>
                    {lineBreakdown}
                    {invoiceCard}
                  </div>
                );
              }

              return (
                <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 16, marginBottom: 16 }}>
                  <div>
                    {lineBreakdown}
                    {invoiceCard}
                  </div>
                  <div>
                    {cheatData ? (
                      <PayAppCheatSheet
                        {...cheatData}
                        appNumber={payApp.app_number}
                        periodFrom={payApp.period_from}
                        periodTo={payApp.period_to}
                        invoiceNumber={invoice?.id}
                        jobNumber={jobNumber}
                        typeOfWork={payApp.type_of_work}
                      />
                    ) : (
                      <div style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui }}>Loading summary…</div>
                    )}
                  </div>
                </div>
              );
            })()}

            {error && (
              <div style={{ background: "#3a1a1a", border: `1px solid #7a2a2a`, color: "#ffbcbc", borderRadius: 6, padding: "8px 12px", fontSize: 12, fontFamily: F.ui, marginBottom: 12 }}>{error}</div>
            )}

            {payApp.status !== "submitted" && payApp.status !== "paid" ? (
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.display, marginBottom: 10 }}>
                  Attachments (sent with pay app)
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                  {/* Completed Pay App */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.linen, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.textFaint, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", minWidth: 140 }}>Completed Pay App</span>
                    {payApp.pdf_url ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                        <a href={payApp.pdf_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, fontWeight: 700, color: C.teal, fontFamily: F.display, background: C.dark, padding: "3px 10px", borderRadius: 5, textDecoration: "none", letterSpacing: "0.04em", textTransform: "uppercase" }}>View</a>
                        <label style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase", cursor: uploading ? "wait" : "pointer", textDecoration: "underline" }}>
                          {uploading ? "Uploading..." : "Replace"}
                          <input type="file" accept="application/pdf,.docx,.xlsx,.xls,image/*" onChange={e => handleUploadCompleted(e.target.files?.[0])} style={{ display: "none" }} disabled={uploading} />
                        </label>
                      </div>
                    ) : (
                      <label style={{ fontSize: 11, fontWeight: 700, color: C.dark, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase", padding: "4px 12px", background: C.teal, borderRadius: 6, cursor: uploading ? "wait" : "pointer" }}>
                        {uploading ? "Uploading..." : "Upload Completed Pay App"}
                        <input type="file" accept="application/pdf,.docx,.xlsx,.xls,image/*" onChange={e => handleUploadCompleted(e.target.files?.[0])} style={{ display: "none" }} disabled={uploading} />
                      </label>
                    )}
                  </div>
                  {/* Schedule of Values */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.linen, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.textFaint, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", minWidth: 140 }}>Schedule of Values</span>
                    {payApp.sov_pdf_url ? (
                      <a href={payApp.sov_pdf_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, fontWeight: 700, color: C.teal, fontFamily: F.display, background: C.dark, padding: "3px 10px", borderRadius: 5, textDecoration: "none", letterSpacing: "0.04em", textTransform: "uppercase" }}>View SOV</a>
                    ) : (
                      <span style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui, fontStyle: "italic" }}>Not generated — use "Add SOV to Pay App" on the billing schedule</span>
                    )}
                  </div>
                  {/* Release Waiver */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.linen, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.textFaint, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", minWidth: 140 }}>Release Waiver</span>
                    {payApp.release_waiver_url ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                        <a href={payApp.release_waiver_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, fontWeight: 700, color: C.teal, fontFamily: F.display, background: C.dark, padding: "3px 10px", borderRadius: 5, textDecoration: "none", letterSpacing: "0.04em", textTransform: "uppercase" }}>View</a>
                        <label style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase", cursor: uploadingWaiver ? "wait" : "pointer", textDecoration: "underline" }}>
                          {uploadingWaiver ? "Uploading..." : "Replace"}
                          <input type="file" accept="application/pdf,image/*" onChange={e => handleUploadWaiver(e.target.files?.[0])} style={{ display: "none" }} disabled={uploadingWaiver} />
                        </label>
                      </div>
                    ) : (
                      <label style={{ fontSize: 11, fontWeight: 700, color: C.dark, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase", padding: "4px 12px", background: C.teal, borderRadius: 6, cursor: uploadingWaiver ? "wait" : "pointer" }}>
                        {uploadingWaiver ? "Uploading..." : "Upload Release Waiver"}
                        <input type="file" accept="application/pdf,image/*" onChange={e => handleUploadWaiver(e.target.files?.[0])} style={{ display: "none" }} disabled={uploadingWaiver} />
                      </label>
                    )}
                  </div>
                  {/* Invoice */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.linen, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.textFaint, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", minWidth: 140 }}>Invoice</span>
                    {invoice ? (
                      <span style={{ fontSize: 11, fontWeight: 700, color: C.teal, fontFamily: F.display, background: C.dark, padding: "3px 10px", borderRadius: 5, letterSpacing: "0.04em" }}>#{invoice.id}</span>
                    ) : (
                      <span style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui, fontStyle: "italic" }}>No linked invoice</span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <button onClick={handleDeletePayApp} style={{ background: "none", border: `1px solid ${C.borderStrong}`, borderRadius: 6, padding: "6px 12px", fontSize: 10, fontWeight: 700, color: C.red || "#e53935", cursor: "pointer", fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase" }}>Delete Pay App</button>
                  <div style={{ display: "flex", gap: 10 }}>
                    <Btn sz="sm" v="ghost" onClick={onClose}>Close</Btn>
                    <Btn sz="sm" onClick={openSendStep} disabled={!invoice}>Send Pay App</Btn>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, display: "flex", justifyContent: "flex-end" }}>
                <Btn sz="sm" v="ghost" onClick={onClose}>Close</Btn>
              </div>
            )}
          </>
        ) : step === "send" ? (
          <>
            <div style={{ marginBottom: 14, fontSize: 12, color: C.textMuted, fontFamily: F.ui }}>
              One email will go to the recipient with the Sales Command invoice PDF attached.
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
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Attachments:</div>
              {payApp?.pdf_url && <div>• Completed Pay App (PDF)</div>}
              {payApp?.sov_pdf_url && <div>• Schedule of Values (PDF)</div>}
              {payApp?.release_waiver_url && <div>• Release Waiver (PDF)</div>}
              <div>• Invoice #{invoice?.id} (PDF)</div>
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
        ) : step === "sent" ? (
          <>
            <div style={{ textAlign: "center", padding: "30px 0" }}>
              <div style={{ background: C.dark, display: "inline-block", padding: "10px 24px", borderRadius: 8, marginBottom: 16 }}>
                <span style={{ color: C.teal, fontSize: 15, fontWeight: 800, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase" }}>Pay App Sent</span>
              </div>
              <div style={{ fontSize: 13, color: C.textBody, fontFamily: F.ui, marginBottom: 6 }}>
                Sent to <b>{recipientEmail}</b>
              </div>
              <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui, marginBottom: 24 }}>
                {new Date(payApp.submitted_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
              </div>

              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.display, marginBottom: 10 }}>
                Package Contents
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center", marginBottom: 24 }}>
                {payApp.pdf_url && (
                  <a href={payApp.pdf_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, fontWeight: 700, color: C.teal, fontFamily: F.display, background: C.dark, padding: "4px 14px", borderRadius: 6, textDecoration: "none", letterSpacing: "0.04em", textTransform: "uppercase" }}>View Completed Pay App</a>
                )}
                {payApp.sov_pdf_url && (
                  <a href={payApp.sov_pdf_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, fontWeight: 700, color: C.teal, fontFamily: F.display, background: C.dark, padding: "4px 14px", borderRadius: 6, textDecoration: "none", letterSpacing: "0.04em", textTransform: "uppercase" }}>View Schedule of Values</a>
                )}
                {payApp.release_waiver_url && (
                  <a href={payApp.release_waiver_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, fontWeight: 700, color: C.teal, fontFamily: F.display, background: C.dark, padding: "4px 14px", borderRadius: 6, textDecoration: "none", letterSpacing: "0.04em", textTransform: "uppercase" }}>View Release Waiver</a>
                )}
                {invoice && (
                  <a href={invoice.pdf_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, fontWeight: 700, color: C.teal, fontFamily: F.display, background: C.dark, padding: "4px 14px", borderRadius: 6, textDecoration: "none", letterSpacing: "0.04em", textTransform: "uppercase" }}>View Invoice #{invoice.id}</a>
                )}
              </div>

              <Btn sz="sm" onClick={onClose}>Done</Btn>
            </div>
          </>
        ) : null}
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
