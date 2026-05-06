import { useEffect, useMemo, useState } from "react";
import { C, F } from "../lib/tokens";
import { fmt$ } from "../lib/utils";
import { supabase } from "../lib/supabase";
import Btn from "./Btn";

// Picks a survivor call_log, previews what will move, requires the user to
// type the loser's display_job_number to enable confirm, then calls the
// merge_call_log RPC.
//
// Props:
//   loserJob — the call_log row currently open (will be archived on success)
//   onClose() — close without action
//   onMerged(survivorId, summary) — fired after a successful merge

export default function MergeJobModal({ loserJob, onClose, onMerged }) {
  const [step, setStep] = useState(1);
  const [allJobs, setAllJobs] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  const [counts, setCounts] = useState(null);
  const [loadingCounts, setLoadingCounts] = useState(false);

  const [soldByJob, setSoldByJob] = useState({}); // { call_log_id: total }
  const [loserSold, setLoserSold] = useState(0);

  const [survivorMaxP, setSurvivorMaxP] = useState(0);
  const [confirmText, setConfirmText] = useState("");
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState(null);

  // Load candidate survivor jobs (active, non-CO, same tenant via RLS, not the loser)
  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      const PAGE = 1000;
      let all = [], from = 0;
      while (true) {
        const { data, error: e } = await supabase
          .from("call_log")
          .select("id, display_job_number, job_number, job_name, customer_name, stage")
          .eq("archived", false)
          .eq("is_change_order", false)
          .order("job_number", { ascending: false })
          .range(from, from + PAGE - 1);
        if (e) { setError(e.message); break; }
        if (!data || data.length === 0) break;
        all = all.concat(data);
        if (data.length < PAGE) break;
        from += PAGE;
      }
      if (cancelled) return;
      const candidates = all.filter(j => j.id !== loserJob.id);
      setAllJobs(candidates);
      setLoadingList(false);

      // Fetch Sold proposal totals for every candidate + the loser, in one query
      const ids = [loserJob.id, ...candidates.map(j => j.id)];
      const { data: props } = await supabase
        .from("proposals")
        .select("call_log_id, total")
        .eq("status", "Sold")
        .is("deleted_at", null)
        .in("call_log_id", ids);
      if (cancelled) return;
      const sums = {};
      (props || []).forEach(p => {
        const k = p.call_log_id;
        sums[k] = (sums[k] || 0) + (parseFloat(p.total) || 0);
      });
      setSoldByJob(sums);
      setLoserSold(sums[loserJob.id] || 0);
    }
    loadAll();
    return () => { cancelled = true; };
  }, [loserJob.id]);

  // Loser's child counts for preview
  useEffect(() => {
    let cancelled = false;
    async function loadCounts() {
      setLoadingCounts(true);
      const [propsActive, propsDel, invsByDisplay, invsById, jwts, cos] = await Promise.all([
        supabase.from("proposals").select("id", { count: "exact", head: true })
          .eq("call_log_id", loserJob.id).is("deleted_at", null),
        supabase.from("proposals").select("id", { count: "exact", head: true })
          .eq("call_log_id", loserJob.id).not("deleted_at", "is", null),
        supabase.from("invoices").select("id", { count: "exact", head: true })
          .is("deleted_at", null).eq("job_id", loserJob.display_job_number),
        supabase.from("invoices").select("id", { count: "exact", head: true })
          .is("deleted_at", null).eq("job_id", String(loserJob.id)),
        supabase.from("job_work_types").select("id", { count: "exact", head: true })
          .eq("call_log_id", loserJob.id),
        supabase.from("call_log").select("id", { count: "exact", head: true })
          .eq("parent_job_id", loserJob.id),
      ]);
      if (cancelled) return;
      setCounts({
        proposalsActive: propsActive.count || 0,
        proposalsDeleted: propsDel.count || 0,
        invoices: (invsByDisplay.count || 0) + (invsById.count || 0),
        jobWorkTypes: jwts.count || 0,
        coChildren: cos.count || 0,
      });
      setLoadingCounts(false);
    }
    loadCounts();
    return () => { cancelled = true; };
  }, [loserJob.id, loserJob.display_job_number]);

  // When survivor picked, fetch its current max proposal_number for preview
  useEffect(() => {
    if (!selectedId) { setSurvivorMaxP(0); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("proposals")
        .select("proposal_number")
        .eq("call_log_id", selectedId)
        .is("deleted_at", null)
        .order("proposal_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setSurvivorMaxP(data?.proposal_number || 0);
    })();
    return () => { cancelled = true; };
  }, [selectedId]);

  const filtered = useMemo(() => {
    if (!q.trim()) return allJobs;
    const s = q.toLowerCase();
    return allJobs.filter(j =>
      (j.display_job_number || "").toLowerCase().includes(s)
      || (j.job_name || "").toLowerCase().includes(s)
      || (j.customer_name || "").toLowerCase().includes(s)
    );
  }, [allJobs, q]);

  const survivor = useMemo(
    () => allJobs.find(j => j.id === selectedId) || null,
    [allJobs, selectedId]
  );

  async function handleConfirm() {
    if (!survivor) return;
    setMerging(true);
    setError(null);
    const { data, error: rpcErr } = await supabase.rpc("merge_call_log", {
      p_survivor_id: survivor.id,
      p_loser_id: loserJob.id,
    });
    if (rpcErr) {
      const msg = rpcErr.message || "";
      if (msg.includes("FORBIDDEN")) setError("You don't have permission to merge jobs.");
      else if (msg.includes("SAME_JOB")) setError("Can't merge a job into itself.");
      else if (msg.includes("TENANT_MISMATCH")) setError("These jobs belong to different tenants.");
      else if (msg.includes("LOSER_IS_CHANGE_ORDER")) setError("Can't merge a change order. Use its parent_job_id instead.");
      else if (msg.includes("SURVIVOR_ARCHIVED")) setError("Survivor is archived. Restore it before merging.");
      else if (msg.includes("NOT_FOUND")) setError("One of the jobs no longer exists. Reload and try again.");
      else setError(msg || "Merge failed. Try again.");
      setMerging(false);
      return;
    }
    setMerging(false);
    onMerged?.(survivor.id, data || {});
  }

  const inputStyle = {
    width: "100%", padding: "10px 12px", fontSize: 13.5, fontFamily: F.ui,
    background: C.linenDeep, color: C.textBody,
    border: `1.5px solid ${C.borderStrong}`, borderRadius: 8,
    WebkitAppearance: "none",
  };

  const noteRow = (label, value) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, fontFamily: F.ui }}>
      <span style={{ color: C.textFaint, fontWeight: 700 }}>{label}</span>
      <span style={{ color: C.textHead, fontWeight: 700 }}>{value}</span>
    </div>
  );

  const expectedConfirm = loserJob.display_job_number || "";

  const renumberPreview = (() => {
    if (!survivor || !counts) return null;
    if (counts.proposalsActive === 0) return "No proposals to move.";
    const start = survivorMaxP + 1;
    const end = survivorMaxP + counts.proposalsActive;
    return `${counts.proposalsActive} proposal${counts.proposalsActive > 1 ? "s" : ""} will become P${start}${start !== end ? "–P" + end : ""} on the survivor.`;
  })();

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(28,24,20,0.65)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: C.linenCard, borderRadius: 14, padding: 32, width: 640, maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.45)", border: `1px solid ${C.borderStrong}` }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            Merge Job
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: C.textFaint }}>✕</button>
        </div>

        <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui, marginBottom: 18, lineHeight: 1.5 }}>
          Move all proposals, invoices, work types, and CO children from <strong style={{ color: C.textHead }}>{loserJob.display_job_number}</strong> into another job, then archive <strong style={{ color: C.textHead }}>{loserJob.display_job_number}</strong>. Absorbed proposals will be renumbered. This is heavy — review the preview carefully.
        </div>

        {step === 1 && (
          <>
            <input
              placeholder="Search by job #, name, or customer…"
              value={q}
              onChange={e => setQ(e.target.value)}
              autoFocus
              style={{ ...inputStyle, marginBottom: 12 }}
            />

            <div style={{ flex: 1, overflowY: "auto", maxHeight: 360, marginBottom: 14, border: `1px solid ${C.border}`, borderRadius: 8, background: C.linenDeep }}>
              {loadingList && (
                <div style={{ padding: 20, textAlign: "center", color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>Loading jobs…</div>
              )}
              {!loadingList && filtered.length === 0 && (
                <div style={{ padding: 20, textAlign: "center", color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>
                  {q.trim() ? "No matches" : "No other active jobs in this tenant"}
                </div>
              )}
              {!loadingList && filtered.map(j => {
                const isSelected = selectedId === j.id;
                return (
                  <div
                    key={j.id}
                    onClick={() => setSelectedId(j.id)}
                    style={{
                      padding: "12px 14px",
                      borderBottom: `1px solid ${C.border}`,
                      cursor: "pointer",
                      background: isSelected ? C.dark : "transparent",
                      borderLeft: isSelected ? `3px solid ${C.teal}` : "3px solid transparent",
                    }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "rgba(28,24,20,0.06)"; }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 800, fontSize: 14, fontFamily: F.display, color: isSelected ? C.teal : C.textHead }}>
                          {j.display_job_number || "(no number)"}
                        </div>
                        {j.stage && (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, background: isSelected ? C.teal : C.dark, color: isSelected ? C.dark : C.teal, letterSpacing: "0.04em", fontFamily: F.ui }}>
                            {j.stage}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 800, fontFamily: F.display, color: isSelected ? C.teal : C.textHead, whiteSpace: "nowrap" }}>
                        {fmt$(soldByJob[j.id] || 0)}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: isSelected ? C.teal : C.textFaint, fontFamily: F.ui, marginTop: 2 }}>
                      {[j.customer_name, j.job_name].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <Btn v="ghost" onClick={onClose}>Cancel</Btn>
              <Btn onClick={() => { setStep(2); setConfirmText(""); }} disabled={!selectedId}>Continue</Btn>
            </div>
          </>
        )}

        {step === 2 && survivor && (
          <>
            <div style={{ background: C.linenDeep, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: "14px 18px", marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textHead, fontFamily: F.display, marginBottom: 12, paddingBottom: 8, borderBottom: `2px solid ${C.borderStrong}` }}>What will happen</div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                <div style={{ background: C.dark, borderRadius: 8, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: C.teal, fontFamily: F.display }}>
                    Survivor (receives everything)
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: C.teal, fontFamily: F.display, textAlign: "right" }}>
                    {survivor.display_job_number} · {fmt$(soldByJob[survivor.id] || 0)}
                  </div>
                </div>
                <div style={{ background: C.dark, borderRadius: 8, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: C.amber, fontFamily: F.display }}>
                    Loser (will be archived)
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: C.amber, fontFamily: F.display, textAlign: "right" }}>
                    {loserJob.display_job_number} · {fmt$(loserSold)}
                  </div>
                </div>
              </div>

              {loadingCounts ? (
                <div style={{ padding: "6px 0", fontSize: 13, color: C.textFaint, fontFamily: F.ui }}>Counting…</div>
              ) : (
                <>
                  {noteRow("Active proposals to move", counts?.proposalsActive ?? 0)}
                  {(counts?.proposalsDeleted ?? 0) > 0 && noteRow("Soft-deleted proposals (repointed only)", counts?.proposalsDeleted)}
                  {noteRow("Invoices to repoint", counts?.invoices ?? 0)}
                  {noteRow("Work types (overlap will dedupe)", counts?.jobWorkTypes ?? 0)}
                  {(counts?.coChildren ?? 0) > 0 && noteRow("CO children to re-parent", counts?.coChildren)}
                </>
              )}
            </div>

            {renumberPreview && (
              <div style={{ padding: "10px 14px", marginBottom: 14, borderRadius: 8, background: C.linen, border: `1px solid ${C.border}`, fontSize: 12.5, color: C.textBody, fontFamily: F.ui, lineHeight: 1.5 }}>
                <strong style={{ color: C.textHead }}>Renumbering: </strong>{renumberPreview}
              </div>
            )}

            {(counts?.coChildren ?? 0) > 0 && (
              <div style={{ padding: "10px 14px", marginBottom: 14, borderRadius: 8, background: "rgba(229,150,57,0.12)", border: `1px solid ${C.amber}`, fontSize: 12.5, color: C.textBody, fontFamily: F.ui, lineHeight: 1.5 }}>
                <strong style={{ color: C.textHead }}>CO numbers: </strong>If the survivor already has a CO with the same number as one of the loser's COs, both will coexist after merge — rename one afterward.
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.ui, marginBottom: 6 }}>
                Type <span style={{ color: C.red, fontWeight: 900, textTransform: "none", letterSpacing: 0 }}>{expectedConfirm}</span> to confirm
              </div>
              <input
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                autoFocus
                placeholder={expectedConfirm}
                style={inputStyle}
              />
            </div>

            {error && (
              <div style={{ padding: "8px 12px", marginBottom: 12, background: "rgba(229,57,53,0.12)", border: `1px solid ${C.red}`, borderRadius: 6, fontSize: 12.5, color: C.red, fontFamily: F.ui }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <Btn v="ghost" onClick={() => { setStep(1); setError(null); }} disabled={merging}>← Back</Btn>
              <div style={{ display: "flex", gap: 10 }}>
                <Btn v="ghost" onClick={onClose} disabled={merging}>Cancel</Btn>
                <Btn onClick={handleConfirm} disabled={confirmText !== expectedConfirm || merging} style={{ background: C.red, color: "#fff" }}>
                  {merging ? "Merging…" : "Confirm Merge"}
                </Btn>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
