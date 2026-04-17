import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { C, F } from "../lib/tokens";
import { fmt$ } from "../lib/utils";
import Btn from "./Btn";
import NewPayAppModal from "./NewPayAppModal";
import PayAppDetailModal from "./PayAppDetailModal";

const inputStyle = {
  padding: "7px 10px", borderRadius: 6, border: `1.5px solid ${C.borderStrong}`,
  background: C.linenDeep, color: C.textBody, fontSize: 13, fontFamily: F.ui,
  WebkitAppearance: "none", outline: "none", width: "100%",
};

const EMPTY_DRAFT = { line_code: "", description: "", scheduled_value: "", is_change_order: false, co_number: "" };

export default function BillingScheduleSection({ proposal, teamMember }) {
  const canManage = !!teamMember && ["Admin", "Manager"].includes(teamMember.role);

  const [schedule, setSchedule] = useState(null);
  const [lines, setLines] = useState([]);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editingLineId, setEditingLineId] = useState(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [addingCo, setAddingCo] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [review, setReview] = useState(null); // { sourceUrl, lines: [...], contract_sum, retainage_pct, notes }
  const [payApps, setPayApps] = useState([]);
  const [showPayAppModal, setShowPayAppModal] = useState(false);
  const [detailPayAppId, setDetailPayAppId] = useState(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const { data: sch } = await supabase
      .from("billing_schedule")
      .select("*")
      .eq("proposal_id", proposal.id)
      .maybeSingle();
    setSchedule(sch);

    if (sch) {
      const [{ data: lns }, { data: apps }, { count }] = await Promise.all([
        supabase.from("billing_schedule_lines")
          .select("*")
          .eq("billing_schedule_id", sch.id)
          .order("ordinal", { ascending: true })
          .order("created_at", { ascending: true }),
        supabase.from("billing_schedule_pay_apps")
          .select("id, app_number, period_from, period_to, this_app_amount, retainage_withheld, current_payment_due, status, pdf_url, invoice_id, created_at")
          .eq("billing_schedule_id", sch.id)
          .order("app_number", { ascending: true }),
        supabase.from("invoices")
          .select("id", { count: "exact", head: true })
          .eq("proposal_id", proposal.id)
          .is("deleted_at", null),
      ]);
      setLines(lns || []);
      setPayApps(apps || []);
      setLocked((count || 0) > 0 || sch.status === "locked");
    } else {
      setLines([]);
      setPayApps([]);
      setLocked(false);
    }
    setLoading(false);
  }, [proposal.id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function createSchedule() {
    setCreating(true);
    const { data, error } = await supabase
      .from("billing_schedule")
      .insert([{ proposal_id: proposal.id, contract_sum: 0, retainage_pct: 5, status: "draft" }])
      .select()
      .single();
    setCreating(false);
    if (error) { alert("Failed to create schedule: " + error.message); return; }
    setSchedule(data);
    setLines([]);
  }

  async function persistContractSum(nextLines) {
    const sum = nextLines.reduce((s, l) => s + (parseFloat(l.scheduled_value) || 0), 0);
    await supabase.from("billing_schedule").update({ contract_sum: sum }).eq("id", schedule.id);
    setSchedule(prev => prev ? { ...prev, contract_sum: sum } : prev);
  }

  async function saveDraftAsLine() {
    if (!draft.description.trim()) { alert("Description required"); return; }
    const nextOrd = lines.length > 0 ? Math.max(...lines.map(l => l.ordinal || 0)) + 1 : 0;
    const payload = {
      billing_schedule_id: schedule.id,
      line_code: draft.line_code.trim() || null,
      description: draft.description.trim(),
      scheduled_value: parseFloat(draft.scheduled_value) || 0,
      is_change_order: !!draft.is_change_order,
      co_number: draft.is_change_order ? (parseInt(draft.co_number, 10) || null) : null,
      ordinal: nextOrd,
    };
    const { data, error } = await supabase.from("billing_schedule_lines").insert([payload]).select().single();
    if (error) { alert("Failed to add line: " + error.message); return; }
    const nextLines = [...lines, data];
    setLines(nextLines);
    await persistContractSum(nextLines);
    setDraft(EMPTY_DRAFT);
    setAddingCo(false);
  }

  async function saveLineEdit(id) {
    if (!draft.description.trim()) { alert("Description required"); return; }
    const patch = {
      line_code: draft.line_code.trim() || null,
      description: draft.description.trim(),
      scheduled_value: parseFloat(draft.scheduled_value) || 0,
      is_change_order: !!draft.is_change_order,
      co_number: draft.is_change_order ? (parseInt(draft.co_number, 10) || null) : null,
    };
    const { data, error } = await supabase.from("billing_schedule_lines").update(patch).eq("id", id).select().single();
    if (error) { alert("Failed to save: " + error.message); return; }
    const nextLines = lines.map(l => l.id === id ? data : l);
    setLines(nextLines);
    await persistContractSum(nextLines);
    setEditingLineId(null);
    setDraft(EMPTY_DRAFT);
  }

  async function deleteLine(id) {
    if (!confirm("Delete this line?")) return;
    const { error } = await supabase.from("billing_schedule_lines").delete().eq("id", id);
    if (error) { alert("Failed to delete: " + error.message); return; }
    const nextLines = lines.filter(l => l.id !== id);
    setLines(nextLines);
    await persistContractSum(nextLines);
  }

  async function updateRetainage(value) {
    const pct = parseFloat(value);
    if (isNaN(pct) || pct < 0 || pct > 100) return;
    await supabase.from("billing_schedule").update({ retainage_pct: pct }).eq("id", schedule.id);
    setSchedule(prev => prev ? { ...prev, retainage_pct: pct } : prev);
  }

  async function lockSchedule() {
    if (lines.length === 0) { alert("Add at least one SOV line before locking."); return; }
    if (!confirm("Lock this schedule? Line items become read-only and pay apps can be created. Change orders can still be appended.")) return;
    const { error } = await supabase.from("billing_schedule").update({ status: "locked" }).eq("id", schedule.id);
    if (error) { alert("Failed to lock: " + error.message); return; }
    setSchedule(prev => prev ? { ...prev, status: "locked" } : prev);
    setLocked(true);
  }

  // Unified doc list: prefer contract_pdf_urls (array), fall back to legacy
  // single contract_pdf_url so pre-backfill rows still render.
  function getDocs(sch = schedule) {
    if (!sch) return [];
    if (Array.isArray(sch.contract_pdf_urls) && sch.contract_pdf_urls.length) return sch.contract_pdf_urls;
    return sch.contract_pdf_url ? [sch.contract_pdf_url] : [];
  }

  function fileNameFromUrl(url) {
    try {
      const last = url.split("/").pop() || url;
      // path pattern: contract-<timestamp>-<original>.pdf → strip prefix
      return decodeURIComponent(last.replace(/^contract-\d+-/, ""));
    } catch { return url; }
  }

  async function uploadContract(file) {
    if (!file) return;
    // Defense-in-depth: storage bucket paths are keyed on proposal.id, so
    // a tampered prop could land a file under another tenant's folder even
    // though the DB write would be blocked by RLS. Verify the caller's
    // tenant owns this proposal before touching storage.
    const { data: tc } = await supabase.from("tenant_config").select("id").single();
    const userTenant = tc?.id;
    const { data: owned } = await supabase
      .from("proposals")
      .select("id")
      .eq("id", proposal.id)
      .eq("tenant_id", userTenant)
      .maybeSingle();
    if (!userTenant || !owned) { alert("Upload blocked: proposal tenant mismatch."); return; }
    setUploading(true);
    const clean = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${proposal.id}/contract-${Date.now()}-${clean}`;
    const { error: upErr } = await supabase.storage.from("job-attachments").upload(path, file);
    if (upErr) { setUploading(false); alert("Upload failed: " + upErr.message); return; }
    const { data: urlData } = supabase.storage.from("job-attachments").getPublicUrl(path);
    const nextUrls = [...getDocs(), urlData.publicUrl];
    await supabase.from("billing_schedule").update({ contract_pdf_urls: nextUrls }).eq("id", schedule.id);
    setSchedule(prev => prev ? { ...prev, contract_pdf_urls: nextUrls } : prev);
    setUploading(false);
  }

  async function removeContractDoc(url) {
    if (!confirm("Remove this document?")) return;
    const nextUrls = getDocs().filter(u => u !== url);
    // Also clear legacy single column if it's the one being removed
    const update = { contract_pdf_urls: nextUrls };
    if (schedule.contract_pdf_url === url) update.contract_pdf_url = null;
    await supabase.from("billing_schedule").update(update).eq("id", schedule.id);
    setSchedule(prev => prev ? { ...prev, ...update } : prev);
  }

  async function runExtraction(url) {
    setExtracting(true);
    try {
      const { data, error } = await supabase.functions.invoke("extract-sov", { body: { pdf_url: url } });
      if (error) throw new Error(error.message || "Extraction failed");
      if (data?.error) throw new Error(data.error);
      const ex = data?.extraction;
      if (!ex || !Array.isArray(ex.lines)) throw new Error("Malformed extraction response");
      setReview({
        sourceUrl: url,
        lines: ex.lines.map(l => ({
          line_code: l.line_code || "",
          description: l.description || "",
          scheduled_value: l.scheduled_value ?? 0,
          is_change_order: !!l.is_change_order,
          co_number: l.co_number ?? null,
        })),
        contract_sum: ex.contract_sum ?? null,
        retainage_pct: ex.retainage_pct ?? null,
        notes: ex.notes || "",
      });
    } catch (e) {
      alert("Extract failed: " + (e?.message || e));
    } finally {
      setExtracting(false);
    }
  }

  async function saveExtractedLines(mode /* "append" | "replace" */) {
    if (!review) return;
    if (mode === "replace" && lines.length > 0) {
      if (!confirm(`Replace all ${lines.length} existing line(s) with the ${review.lines.length} extracted line(s)?`)) return;
      const { error: delErr } = await supabase.from("billing_schedule_lines").delete().eq("billing_schedule_id", schedule.id);
      if (delErr) { alert("Failed to clear existing lines: " + delErr.message); return; }
    }
    const baseOrd = mode === "append" && lines.length > 0 ? Math.max(...lines.map(l => l.ordinal || 0)) + 1 : 0;
    const rows = review.lines
      .filter(l => l.description.trim())
      .map((l, i) => ({
        billing_schedule_id: schedule.id,
        line_code: l.line_code?.trim() || null,
        description: l.description.trim(),
        scheduled_value: parseFloat(l.scheduled_value) || 0,
        is_change_order: !!l.is_change_order,
        co_number: l.is_change_order ? (l.co_number ?? null) : null,
        ordinal: baseOrd + i,
      }));
    if (!rows.length) { alert("No lines to save"); return; }
    const { data: inserted, error } = await supabase.from("billing_schedule_lines").insert(rows).select();
    if (error) { alert("Failed to save lines: " + error.message); return; }
    const nextLines = mode === "replace" ? inserted : [...lines, ...inserted];
    setLines(nextLines);
    // Update contract_sum from line sum; optionally sync retainage_pct if extracted
    const sum = nextLines.reduce((s, l) => s + (parseFloat(l.scheduled_value) || 0), 0);
    const schedPatch = { contract_sum: sum };
    if (review.retainage_pct != null) schedPatch.retainage_pct = review.retainage_pct;
    await supabase.from("billing_schedule").update(schedPatch).eq("id", schedule.id);
    setSchedule(prev => prev ? { ...prev, ...schedPatch } : prev);
    setReview(null);
  }

  function startEdit(line) {
    if (locked) return;
    setEditingLineId(line.id);
    setDraft({
      line_code: line.line_code || "",
      description: line.description || "",
      scheduled_value: String(line.scheduled_value ?? ""),
      is_change_order: !!line.is_change_order,
      co_number: line.co_number != null ? String(line.co_number) : "",
    });
    setAddingCo(false);
  }

  function cancelEdit() {
    setEditingLineId(null);
    setDraft(EMPTY_DRAFT);
    setAddingCo(false);
  }

  // ---------- RENDER ----------

  const card = { background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: 20 };
  const h = { fontWeight: 800, fontSize: 12.5, color: C.textHead, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase" };

  if (loading) {
    return (
      <div style={card}>
        <div style={h}>Customer Billing Schedule</div>
        <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui, marginTop: 10 }}>Loading…</div>
      </div>
    );
  }

  if (!schedule) {
    return (
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={h}>Customer Billing Schedule</div>
          {canManage && (
            <Btn sz="sm" onClick={createSchedule} disabled={creating}>
              {creating ? "Creating…" : "+ Create Billing Schedule"}
            </Btn>
          )}
        </div>
        <div style={{ fontSize: 12.5, color: C.textMuted, fontFamily: F.ui, lineHeight: 1.5 }}>
          {canManage
            ? "Create a Schedule of Values (G702/G703 framework) when the customer's contract defines its own pay items. Invoices will bill % per SOV line instead of % per WTC."
            : "No billing schedule yet. An Admin or Manager will create one after the customer's contract comes back."}
        </div>
      </div>
    );
  }

  // Sales (non-manage) view: upload + view contract docs only. No delete.
  if (!canManage) {
    const docs = getDocs();
    return (
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={h}>Customer Billing Schedule</div>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.textFaint, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase" }}>Contract Documents</span>
        </div>
        {docs.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {docs.map(url => (
              <a key={url} href={url} target="_blank" rel="noopener noreferrer" style={{ background: C.dark, color: C.teal, fontWeight: 700, fontSize: 11, fontFamily: F.display, letterSpacing: "0.04em", padding: "5px 12px", borderRadius: 6, textDecoration: "none" }}>
                {fileNameFromUrl(url)}
              </a>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <label style={{ background: C.dark, color: C.teal, fontWeight: 700, fontSize: 11, fontFamily: F.display, letterSpacing: "0.06em", padding: "6px 14px", borderRadius: 6, cursor: "pointer", textTransform: "uppercase" }}>
            {uploading ? "Uploading…" : docs.length ? "+ Add Another Document" : "+ Upload Contract"}
            <input type="file" accept="application/pdf,image/*" onChange={e => uploadContract(e.target.files?.[0])} style={{ display: "none" }} disabled={uploading} />
          </label>
          {docs.length === 0 && (
            <span style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui }}>Upload the signed customer contract and any addenda.</span>
          )}
        </div>
      </div>
    );
  }

  const contractSum = parseFloat(schedule.contract_sum) || 0;
  const coLines = lines.filter(l => l.is_change_order);
  const baseLines = lines.filter(l => !l.is_change_order);
  const baseTotal = baseLines.reduce((s, l) => s + (parseFloat(l.scheduled_value) || 0), 0);
  const coTotal = coLines.reduce((s, l) => s + (parseFloat(l.scheduled_value) || 0), 0);

  const statusBadge = locked
    ? { label: "Locked", color: C.teal, bg: C.dark }
    : schedule.status === "active"
    ? { label: "Active", color: C.green, bg: C.dark }
    : { label: "Draft", color: C.amber, bg: C.dark };

  return (
    <div style={card}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={h}>Customer Billing Schedule</div>
          <span style={{ background: statusBadge.bg, color: statusBadge.color, fontSize: 10.5, fontWeight: 700, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase", padding: "3px 10px", borderRadius: 6 }}>{statusBadge.label}</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {schedule.status === "draft" && (
            <Btn sz="sm" v="secondary" onClick={lockSchedule} disabled={lines.length === 0}>Lock Schedule</Btn>
          )}
          {(schedule.status === "locked" || locked) && (
            <Btn sz="sm" onClick={() => setShowPayAppModal(true)}>+ New Pay App</Btn>
          )}
        </div>
      </div>

      {locked && (
        <div style={{ background: C.dark, border: `1px solid ${C.tealBorder}`, borderRadius: 8, padding: "10px 14px", marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.teal, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 3 }}>Schedule Locked</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", fontFamily: F.ui }}>
            Schedule is finalized and ready for pay apps. Line items are read-only. Change orders can still be appended.
          </div>
        </div>
      )}

      {/* Contract + Retainage controls */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
        {/* Contract Documents */}
        <div style={{ background: C.linen, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.textFaint, fontFamily: F.display, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>Contract Documents</div>
          {(() => {
            const docs = getDocs();
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {docs.map(url => (
                  <div key={url} style={{ display: "flex", gap: 5, alignItems: "center" }}>
                    <a href={url} target="_blank" rel="noopener noreferrer" style={{ background: C.dark, color: C.teal, fontWeight: 700, fontSize: 10.5, fontFamily: F.display, letterSpacing: "0.03em", padding: "3px 9px", borderRadius: 5, textDecoration: "none", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 140 }} title={fileNameFromUrl(url)}>
                      {fileNameFromUrl(url)}
                    </a>
                    {!locked && (
                      <button onClick={() => runExtraction(url)} disabled={extracting} title="Extract SOV from this document" style={{ background: C.teal, color: C.dark, border: "none", borderRadius: 4, padding: "3px 8px", fontSize: 9.5, fontWeight: 800, cursor: extracting ? "default" : "pointer", fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase", opacity: extracting ? 0.5 : 1 }}>
                        {extracting && review?.sourceUrl === url ? "…" : "Extract"}
                      </button>
                    )}
                    {!locked && (
                      <button onClick={() => removeContractDoc(url)} title="Remove" style={{ background: "none", border: `1px solid ${C.borderStrong}`, borderRadius: 4, padding: "2px 7px", fontSize: 11, fontWeight: 700, color: C.red || "#e53935", cursor: "pointer", fontFamily: F.display, lineHeight: 1 }}>×</button>
                    )}
                  </div>
                ))}
                {!locked && (
                  <label style={{ background: C.dark, color: C.teal, fontWeight: 700, fontSize: 10.5, fontFamily: F.display, letterSpacing: "0.05em", padding: "4px 10px", borderRadius: 5, cursor: "pointer", textTransform: "uppercase", display: "inline-block", textAlign: "center", marginTop: docs.length ? 3 : 0 }}>
                    {uploading ? "Uploading…" : docs.length ? "+ Add Another" : "+ Upload PDF"}
                    <input type="file" accept="application/pdf,image/*" onChange={e => uploadContract(e.target.files?.[0])} style={{ display: "none" }} disabled={uploading} />
                  </label>
                )}
                {locked && docs.length === 0 && (
                  <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui }}>No file</div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Contract Sum (derived) */}
        <div style={{ background: C.linen, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.textFaint, fontFamily: F.display, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>Contract Sum</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.textHead, fontFamily: F.display }}>{fmt$(contractSum)}</div>
          <div style={{ fontSize: 10, color: C.textFaint, fontFamily: F.ui, marginTop: 2 }}>
            Base {fmt$(baseTotal)}{coTotal > 0 ? ` · CO ${fmt$(coTotal)}` : ""}
          </div>
        </div>

        {/* Retainage */}
        <div style={{ background: C.linen, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.textFaint, fontFamily: F.display, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>Retainage %</div>
          {locked ? (
            <div style={{ fontSize: 18, fontWeight: 800, color: C.textHead, fontFamily: F.display }}>{parseFloat(schedule.retainage_pct).toFixed(1)}%</div>
          ) : (
            <input
              type="number" step="0.1" min="0" max="100"
              defaultValue={schedule.retainage_pct}
              onBlur={e => updateRetainage(e.target.value)}
              style={{ ...inputStyle, fontSize: 16, fontWeight: 800, padding: "4px 10px", fontFamily: F.display }}
            />
          )}
        </div>
      </div>

      {/* Lines table */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "60px 110px 1fr 140px 90px 90px", background: C.dark, padding: "8px 12px", gap: 10 }}>
          {["#", "Code", "Description", "Scheduled Value", "CO", ""].map((h, i) => (
            <div key={i} style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.5)", fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase" }}>{h}</div>
          ))}
        </div>

        {lines.length === 0 && editingLineId == null && !addingCo && (
          <div style={{ padding: "14px 16px", fontSize: 12.5, color: C.textFaint, fontFamily: F.ui, background: C.linenLight }}>
            No lines yet. Add the customer's SOV line items below.
          </div>
        )}

        {lines.map((l, idx) => {
          const isEditing = editingLineId === l.id;
          if (isEditing) {
            return (
              <LineEditRow
                key={l.id}
                ordinal={idx + 1}
                draft={draft}
                setDraft={setDraft}
                onSave={() => saveLineEdit(l.id)}
                onCancel={cancelEdit}
              />
            );
          }
          return (
            <div key={l.id} style={{
              display: "grid", gridTemplateColumns: "60px 110px 1fr 140px 90px 90px", padding: "10px 12px", gap: 10, alignItems: "center",
              borderTop: idx > 0 ? `1px solid ${C.border}` : "none",
              background: idx % 2 === 0 ? C.linenLight : C.linen,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.textFaint, fontFamily: F.ui }}>{idx + 1}</div>
              <div style={{ fontSize: 12, color: C.textBody, fontFamily: F.ui }}>{l.line_code || <span style={{ color: C.textFaint }}>—</span>}</div>
              <div style={{ fontSize: 13, color: C.textHead, fontFamily: F.ui }}>{l.description}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.textHead, fontFamily: F.ui, textAlign: "right" }}>{fmt$(l.scheduled_value)}</div>
              <div>
                {l.is_change_order && (
                  <span style={{ background: "rgba(151,71,255,0.12)", color: "#9747ff", fontSize: 10, fontWeight: 700, fontFamily: F.display, letterSpacing: "0.06em", padding: "3px 8px", borderRadius: 5, textTransform: "uppercase" }}>
                    CO{l.co_number || ""}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                {!locked && (
                  <>
                    <button onClick={() => startEdit(l)} style={{ background: "none", border: `1px solid ${C.borderStrong}`, borderRadius: 5, padding: "3px 8px", fontSize: 10, fontWeight: 700, color: C.textMuted, cursor: "pointer", fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>Edit</button>
                    <button onClick={() => deleteLine(l.id)} style={{ background: "none", border: `1px solid ${C.borderStrong}`, borderRadius: 5, padding: "3px 8px", fontSize: 10, fontWeight: 700, color: C.red || "#e53935", cursor: "pointer", fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>×</button>
                  </>
                )}
              </div>
            </div>
          );
        })}

        {/* Inline add row */}
        {editingLineId == null && (addingCo || !locked) && (
          <LineEditRow
            ordinal={lines.length + 1}
            draft={draft}
            setDraft={setDraft}
            isAdd
            onSave={saveDraftAsLine}
            onCancel={() => { setDraft(EMPTY_DRAFT); setAddingCo(false); }}
          />
        )}
      </div>

      {/* Add buttons below table */}
      {editingLineId == null && (
        <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
          {locked ? (
            <Btn sz="sm" v="ghost" onClick={() => { setDraft({ ...EMPTY_DRAFT, is_change_order: true, co_number: String((Math.max(0, ...coLines.map(c => c.co_number || 0))) + 1) }); setAddingCo(true); }}>
              + Add Change Order Line
            </Btn>
          ) : null}
        </div>
      )}

      {/* Extraction spinner overlay */}
      {extracting && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(28,24,20,0.6)", zIndex: 99, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <style>{`
            @keyframes sc-spin { to { transform: rotate(360deg); } }
            @keyframes sc-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
            @keyframes sc-dot1 { 0%, 20% { opacity: 0.2; } 40% { opacity: 1; } 100% { opacity: 0.2; } }
            @keyframes sc-dot2 { 0%, 40% { opacity: 0.2; } 60% { opacity: 1; } 100% { opacity: 0.2; } }
            @keyframes sc-dot3 { 0%, 60% { opacity: 0.2; } 80% { opacity: 1; } 100% { opacity: 0.2; } }
          `}</style>
          <div style={{ background: C.linenCard, borderRadius: 10, padding: "26px 38px", border: `1px solid ${C.borderStrong}`, display: "flex", flexDirection: "column", alignItems: "center", gap: 16, minWidth: 280 }}>
            <div style={{
              width: 42, height: 42, borderRadius: "50%",
              border: `3px solid ${C.borderStrong}`,
              borderTopColor: C.teal,
              animation: "sc-spin 0.8s linear infinite",
            }} />
            <div style={{
              fontFamily: F.display, fontSize: 13, fontWeight: 800,
              color: C.teal, letterSpacing: "0.1em", textTransform: "uppercase",
              animation: "sc-pulse 1.4s ease-in-out infinite",
              display: "flex", alignItems: "baseline", gap: 2,
            }}>
              <span>Reading contract</span>
              <span style={{ animation: "sc-dot1 1.4s infinite" }}>.</span>
              <span style={{ animation: "sc-dot2 1.4s infinite" }}>.</span>
              <span style={{ animation: "sc-dot3 1.4s infinite" }}>.</span>
            </div>
            <div style={{ fontFamily: F.ui, fontSize: 11.5, color: C.textMuted, textAlign: "center", maxWidth: 260, lineHeight: 1.4 }}>
              Extracting SOV line items with Claude — this usually takes 20–60 seconds depending on document length.
            </div>
          </div>
        </div>
      )}

      {/* Pay Apps history */}
      {payApps.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textFaint, fontFamily: F.display, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>Pay Apps</div>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 120px 120px 120px 120px 80px", background: C.dark, padding: "8px 12px", gap: 10 }}>
              {["#", "Period", "This App", "Retention", "Payment Due", "Invoice", "PDF"].map((hh, i) => (
                <div key={i} style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.5)", fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase", textAlign: i === 0 || i === 1 ? "left" : i === 6 ? "center" : "right" }}>{hh}</div>
              ))}
            </div>
            {payApps.map(pa => (
              <div key={pa.id} onClick={() => setDetailPayAppId(pa.id)} style={{ display: "grid", gridTemplateColumns: "60px 1fr 120px 120px 120px 120px 80px", padding: "8px 12px", gap: 10, borderTop: `1px solid ${C.border}`, alignItems: "center", background: C.linenLight, cursor: "pointer" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: C.textHead, fontFamily: F.display }}>#{pa.app_number}</div>
                <div style={{ fontSize: 12, color: C.textBody, fontFamily: F.ui }}>{pa.period_from || "—"} to {pa.period_to || "—"}</div>
                <div style={{ fontSize: 12.5, color: C.textBody, fontFamily: F.ui, textAlign: "right" }}>{fmt$(pa.this_app_amount || 0)}</div>
                <div style={{ fontSize: 12.5, color: C.textFaint, fontFamily: F.ui, textAlign: "right" }}>{fmt$(pa.retainage_withheld || 0)}</div>
                <div style={{ fontSize: 12.5, color: C.textHead, fontFamily: F.ui, fontWeight: 700, textAlign: "right" }}>{fmt$(pa.current_payment_due || 0)}</div>
                <div style={{ fontSize: 12, fontFamily: F.ui, textAlign: "right" }}>{pa.invoice_id ? <span style={{ background: C.dark, color: C.teal, fontWeight: 700, fontFamily: F.display, letterSpacing: "0.04em", padding: "3px 10px", borderRadius: 6, fontSize: 11 }}>#{pa.invoice_id}</span> : <span style={{ color: C.textFaint }}>—</span>}</div>
                <div style={{ textAlign: "center" }} onClick={e => e.stopPropagation()}>
                  {pa.pdf_url ? (
                    <a href={pa.pdf_url} target="_blank" rel="noopener noreferrer" style={{ background: C.dark, color: C.teal, fontWeight: 700, fontSize: 10, fontFamily: F.display, letterSpacing: "0.05em", padding: "3px 9px", borderRadius: 4, textDecoration: "none", textTransform: "uppercase" }}>View</a>
                  ) : <span style={{ fontSize: 11, color: C.textFaint }}>—</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Review modal */}
      {review && <ExtractReviewModal review={review} setReview={setReview} onSave={saveExtractedLines} hasExistingLines={lines.length > 0} fileNameFromUrl={fileNameFromUrl} />}

      {/* New Pay App modal */}
      {showPayAppModal && (
        <NewPayAppModal
          schedule={schedule}
          lines={lines}
          proposal={proposal}
          onClose={() => setShowPayAppModal(false)}
          onCreated={() => { setShowPayAppModal(false); loadAll(); }}
        />
      )}

      {/* Pay App Detail modal */}
      {detailPayAppId && (
        <PayAppDetailModal
          payAppId={detailPayAppId}
          schedule={schedule}
          proposal={proposal}
          onClose={() => setDetailPayAppId(null)}
          onChanged={() => loadAll()}
        />
      )}
    </div>
  );
}

function ExtractReviewModal({ review, setReview, onSave, hasExistingLines, fileNameFromUrl }) {
  const setLine = (i, patch) => setReview(r => ({ ...r, lines: r.lines.map((l, j) => j === i ? { ...l, ...patch } : l) }));
  const removeLine = (i) => setReview(r => ({ ...r, lines: r.lines.filter((_, j) => j !== i) }));
  const addBlankLine = () => setReview(r => ({ ...r, lines: [...r.lines, { line_code: "", description: "", scheduled_value: 0, is_change_order: false, co_number: null }] }));

  const extractedSum = review.lines.reduce((s, l) => s + (parseFloat(l.scheduled_value) || 0), 0);
  const mismatch = review.contract_sum != null && Math.abs(extractedSum - review.contract_sum) > 1;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(28,24,20,0.65)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: C.linenCard, borderRadius: 14, padding: 24, width: "min(1100px, 96vw)", maxHeight: "92vh", display: "flex", flexDirection: "column", border: `1px solid ${C.borderStrong}`, boxShadow: "0 24px 64px rgba(0,0,0,0.45)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>Review Extracted SOV</h2>
            <div style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui, marginTop: 4 }}>From <span style={{ color: C.textBody, fontWeight: 700 }}>{fileNameFromUrl(review.sourceUrl)}</span></div>
          </div>
          <button onClick={() => setReview(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: C.textFaint }}>✕</button>
        </div>

        {review.notes && (
          <div style={{ padding: "8px 12px", background: C.linen, borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 12, color: C.textMuted, fontFamily: F.ui, marginBottom: 10 }}>
            {review.notes}
          </div>
        )}

        <div style={{ display: "flex", gap: 18, marginBottom: 10, fontSize: 12, fontFamily: F.ui }}>
          <div>
            <span style={{ color: C.textFaint, fontWeight: 700, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", fontSize: 10 }}>Line count:</span>{" "}
            <span style={{ color: C.textHead, fontWeight: 800 }}>{review.lines.length}</span>
          </div>
          <div>
            <span style={{ color: C.textFaint, fontWeight: 700, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", fontSize: 10 }}>Sum of lines:</span>{" "}
            <span style={{ color: C.textHead, fontWeight: 800 }}>{fmt$(extractedSum)}</span>
          </div>
          {review.contract_sum != null && (
            <div>
              <span style={{ color: C.textFaint, fontWeight: 700, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", fontSize: 10 }}>Doc's stated total:</span>{" "}
              <span style={{ color: mismatch ? "#a07800" : C.textHead, fontWeight: 800 }}>
                {fmt$(review.contract_sum)} {mismatch && "⚠"}
              </span>
            </div>
          )}
          {review.retainage_pct != null && (
            <div>
              <span style={{ color: C.textFaint, fontWeight: 700, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", fontSize: 10 }}>Retainage:</span>{" "}
              <span style={{ color: C.textHead, fontWeight: 800 }}>{review.retainage_pct}%</span>
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", border: `1px solid ${C.borderStrong}`, borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: F.ui }}>
            <thead>
              <tr style={{ background: C.dark, position: "sticky", top: 0, zIndex: 1 }}>
                <th style={{ ...thStyle, width: 40 }}>#</th>
                <th style={{ ...thStyle, width: 90 }}>Code</th>
                <th style={thStyle}>Description</th>
                <th style={{ ...thStyle, textAlign: "right", width: 140 }}>Scheduled Value</th>
                <th style={{ ...thStyle, width: 70 }}>CO</th>
                <th style={{ ...thStyle, width: 60 }}>CO#</th>
                <th style={{ ...thStyle, width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {review.lines.map((l, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 === 0 ? C.linen : C.linenLight }}>
                  <td style={tdBase}>{i + 1}</td>
                  <td style={tdBase}>
                    <input value={l.line_code} onChange={e => setLine(i, { line_code: e.target.value })} style={cellInput} />
                  </td>
                  <td style={tdBase}>
                    <input value={l.description} onChange={e => setLine(i, { description: e.target.value })} style={cellInput} />
                  </td>
                  <td style={{ ...tdBase, textAlign: "right" }}>
                    <input type="number" step="0.01" value={l.scheduled_value} onChange={e => setLine(i, { scheduled_value: e.target.value })} style={{ ...cellInput, textAlign: "right" }} />
                  </td>
                  <td style={tdBase}>
                    <input type="checkbox" checked={!!l.is_change_order} onChange={e => setLine(i, { is_change_order: e.target.checked, co_number: e.target.checked ? (l.co_number ?? 1) : null })} />
                  </td>
                  <td style={tdBase}>
                    {l.is_change_order ? (
                      <input type="number" value={l.co_number ?? ""} onChange={e => setLine(i, { co_number: parseInt(e.target.value) || null })} style={{ ...cellInput, width: 50 }} />
                    ) : <span style={{ color: C.textFaint }}>—</span>}
                  </td>
                  <td style={tdBase}>
                    <button onClick={() => removeLine(i)} style={{ background: "none", border: `1px solid ${C.borderStrong}`, borderRadius: 4, padding: "2px 7px", fontSize: 11, fontWeight: 700, color: C.red || "#e53935", cursor: "pointer", fontFamily: F.display, lineHeight: 1 }}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, gap: 12 }}>
          <button onClick={addBlankLine} style={{ background: "none", border: `1.5px dashed ${C.borderStrong}`, borderRadius: 7, padding: "6px 14px", fontSize: 11, fontWeight: 700, color: C.textMuted, cursor: "pointer", fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>+ Add Line</button>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setReview(null)} style={{ background: "none", border: "none", cursor: "pointer", color: C.tealDark, fontWeight: 800, fontSize: 12, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", padding: "8px 12px" }}>Cancel</button>
            {hasExistingLines && (
              <Btn sz="sm" v="ghost" onClick={() => onSave("append")}>Append to Existing</Btn>
            )}
            <Btn sz="sm" onClick={() => onSave(hasExistingLines ? "replace" : "append")}>
              {hasExistingLines ? "Replace Existing →" : "Save to Schedule →"}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

const thStyle = {
  padding: "9px 10px", textAlign: "left", fontWeight: 700, fontSize: 10, color: "rgba(255,255,255,0.55)",
  textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: F.display, borderBottom: `1px solid rgba(255,255,255,0.1)`,
};
const tdBase = { padding: "5px 8px", verticalAlign: "middle", color: C.textBody, fontFamily: F.ui, fontSize: 12.5 };
const cellInput = {
  padding: "4px 8px", borderRadius: 4, border: `1px solid ${C.borderStrong}`,
  background: C.linenDeep, color: C.textBody, fontSize: 12.5, fontFamily: F.ui,
  WebkitAppearance: "none", outline: "none", width: "100%",
};

// Inline row for add-or-edit. Same layout as display rows so the table stays aligned.
function LineEditRow({ ordinal, draft, setDraft, onSave, onCancel, isAdd }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "60px 110px 1fr 140px 90px 90px", padding: "10px 12px", gap: 10, alignItems: "center",
      borderTop: `1px solid ${C.border}`, background: C.linenDeep,
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.textFaint, fontFamily: F.ui }}>{ordinal}</div>
      <input value={draft.line_code} onChange={e => setDraft(d => ({ ...d, line_code: e.target.value }))} placeholder="A.1" style={inputStyle} />
      <input value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} placeholder={isAdd ? "Add SOV line description…" : "Description"} style={inputStyle} autoFocus={isAdd} />
      <input type="number" step="0.01" value={draft.scheduled_value} onChange={e => setDraft(d => ({ ...d, scheduled_value: e.target.value }))} placeholder="0.00" style={{ ...inputStyle, textAlign: "right" }} />
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontFamily: F.ui, color: C.textMuted, cursor: "pointer" }}>
          <input type="checkbox" checked={draft.is_change_order} onChange={e => setDraft(d => ({ ...d, is_change_order: e.target.checked }))} />
          CO
        </label>
        {draft.is_change_order && (
          <input type="number" min="1" value={draft.co_number} onChange={e => setDraft(d => ({ ...d, co_number: e.target.value }))} placeholder="#" style={{ ...inputStyle, padding: "5px 7px", width: 40, fontSize: 11 }} />
        )}
      </div>
      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
        <button onClick={onSave} style={{ background: C.dark, color: C.teal, border: "none", borderRadius: 5, padding: "5px 10px", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          {isAdd ? "Add" : "Save"}
        </button>
        <button onClick={onCancel} style={{ background: "none", border: `1px solid ${C.borderStrong}`, borderRadius: 5, padding: "4px 8px", fontSize: 10, fontWeight: 700, color: C.textFaint, cursor: "pointer", fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>✕</button>
      </div>
    </div>
  );
}
