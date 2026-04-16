import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { C, F } from "../lib/tokens";
import { fmt$ } from "../lib/utils";
import Btn from "./Btn";

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

  const loadAll = useCallback(async () => {
    setLoading(true);
    const { data: sch } = await supabase
      .from("billing_schedule")
      .select("*")
      .eq("proposal_id", proposal.id)
      .maybeSingle();
    setSchedule(sch);

    if (sch) {
      const { data: lns } = await supabase
        .from("billing_schedule_lines")
        .select("*")
        .eq("billing_schedule_id", sch.id)
        .order("ordinal", { ascending: true })
        .order("created_at", { ascending: true });
      setLines(lns || []);

      const { count } = await supabase
        .from("invoices")
        .select("id", { count: "exact", head: true })
        .eq("proposal_id", proposal.id)
        .is("deleted_at", null);
      setLocked((count || 0) > 0 || sch.status === "locked");
    } else {
      setLines([]);
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
      </div>

      {locked && (
        <div style={{ background: C.dark, border: `1px solid ${C.tealBorder}`, borderRadius: 8, padding: "10px 14px", marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.teal, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 3 }}>Schedule Locked</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", fontFamily: F.ui }}>
            An invoice has been issued against this proposal. The schedule is read-only. Change orders can still be appended.
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
                    <a href={url} target="_blank" rel="noopener noreferrer" style={{ background: C.dark, color: C.teal, fontWeight: 700, fontSize: 10.5, fontFamily: F.display, letterSpacing: "0.03em", padding: "3px 9px", borderRadius: 5, textDecoration: "none", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 }} title={fileNameFromUrl(url)}>
                      {fileNameFromUrl(url)}
                    </a>
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
    </div>
  );
}

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
