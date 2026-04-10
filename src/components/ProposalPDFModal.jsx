import { useEffect, useState } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import { fmt$, fmt$c } from "../lib/utils";
import { calcLabor, calcMaterialRow, calcTravel } from "../lib/calc";
import { getTenantConfig, DEFAULTS } from "../lib/config";

function ProposalPDFModal({ proposal, onClose, mode = "send", onInternalApprove }) {
  const money = proposal.call_log?.show_cents ? fmt$c : fmt$;
  const [wtcs, setWtcs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("preview");
  const [sendDone, setSendDone] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [COMPANY, setCOMPANY] = useState({ name: DEFAULTS.company_name, tagline: DEFAULTS.tagline, phone: DEFAULTS.phone, email: DEFAULTS.email, website: DEFAULTS.website, license: DEFAULTS.license_number, logo_url: DEFAULTS.logo_url });
  const [repContact, setRepContact] = useState({ phone: "", email: "" });
  const [contacts, setContacts] = useState([]);
  const [signerEmail, setSignerEmail] = useState("");
  const [viewerEmails, setViewerEmails] = useState([]);

  useEffect(() => {
    getTenantConfig().then(cfg => setCOMPANY({ name: cfg.company_name, tagline: cfg.tagline, phone: cfg.phone, email: cfg.email, website: cfg.website, license: cfg.license_number, logo_url: cfg.logo_url }));
    const salesName = proposal.call_log?.sales_name;
    if (salesName) {
      supabase.from("team_members").select("phone, email").eq("name", salesName).maybeSingle().then(({ data }) => {
        if (data) setRepContact({ phone: data.phone || "", email: data.email || "" });
      });
    }
    // Load customer contacts
    const custId = proposal.call_log?.customer_id;
    const primaryEmail = proposal.call_log?.customers?.contact_email || proposal.call_log?.customers?.email || "";
    const primaryName = proposal.call_log?.customer_name || proposal.customer || "";
    const allContacts = [];
    if (primaryEmail) allContacts.push({ name: primaryName, email: primaryEmail, role: "Primary", isPrimary: true });
    if (custId) {
      supabase.from("customer_contacts").select("*").eq("customer_id", custId).order("created_at").then(({ data }) => {
        const extra = (data || []).filter(c => c.email && c.email !== primaryEmail).map(c => ({ name: c.name, email: c.email, role: c.role }));
        setContacts([...allContacts, ...extra]);
        if (primaryEmail) setSignerEmail(primaryEmail);
      });
    } else {
      setContacts(allContacts);
      if (primaryEmail) setSignerEmail(primaryEmail);
    }
  }, []);
  const signingUrl = `https://salescommand.app/sign/${proposal.signing_token}`;

  const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  async function handleSend() {
    if (!signerEmail) {
      setSendError("Please select a signer.");
      return;
    }
    const badEmails = [signerEmail, ...viewerEmails].filter(e => !isValidEmail(e));
    if (badEmails.length) {
      setSendError(`Invalid email address: ${badEmails.join(", ")}`);
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      const salesName = proposal.call_log?.sales_name || "";
      let repEmail = "";
      if (salesName) {
        const { data: rep } = await supabase.from("team_members").select("email").eq("name", salesName).maybeSingle();
        repEmail = rep?.email || "";
      }
      // Send to signer
      const signerContact = contacts.find(c => c.email === signerEmail);
      const { data: fnData, error: fnError } = await supabase.functions.invoke("send-proposal", {
        body: {
          customerEmail: signerEmail,
          customerName: signerContact?.name || proposal.call_log?.customer_name || "Customer",
          repEmail,
          repName: salesName,
          companyName: COMPANY.name,
          proposalNumber: proposal.proposal_number || proposal.id,
          jobName: proposal.call_log?.job_name || proposal.call_log?.display_job_number || "",
          signingUrl,
        },
      });
      if (fnError) throw new Error(fnError.message || "Send failed.");
      if (fnData?.error) throw new Error(fnData.error);

      // Send to viewers (same email, they get the link but page shows read-only for non-signers)
      for (const vEmail of viewerEmails) {
        const vContact = contacts.find(c => c.email === vEmail);
        await supabase.functions.invoke("send-proposal", {
          body: {
            customerEmail: vEmail,
            customerName: vContact?.name || "Viewer",
            repEmail,
            repName: salesName,
            companyName: COMPANY.name,
            proposalNumber: proposal.proposal_number || proposal.id,
            jobName: proposal.call_log?.job_name || proposal.call_log?.display_job_number || "",
            signingUrl,
          },
        });
      }

      // Save recipients to proposal_recipients
      const now = new Date().toISOString();
      const recipients = [
        { proposal_id: proposal.id, contact_name: signerContact?.name || "", contact_email: signerEmail, role: "signer", sent_at: now },
        ...viewerEmails.map(vEmail => {
          const vc = contacts.find(c => c.email === vEmail);
          return { proposal_id: proposal.id, contact_name: vc?.name || "", contact_email: vEmail, role: "viewer", sent_at: now };
        }),
      ];
      await supabase.from("proposal_recipients").insert(recipients);

      setSendDone(true);
      if (proposal.call_log_id) {
        await supabase.from("call_log").update({ stage: "Has Bid" }).eq("id", proposal.call_log_id);
      }
      await supabase.from("proposals").update({ status: "Sent", sent_at: now, sent_to_email: signerEmail }).eq("id", proposal.id);
    } catch (e) {
      setSendError(e.message || "Send failed. Please try again.");
    }
    setSending(false);
  }

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("proposal_wtc")
        .select("*, work_types(name)")
        .eq("proposal_id", proposal.id)
        .order("created_at", { ascending: true });
      setWtcs(data || []);
      setLoading(false);
    }
    load();
  }, [proposal.id]);

  // Aggregate totals across all WTCs
  const totals = wtcs.reduce((acc, wtc) => {
    const labor = calcLabor({
      regular_hours:  wtc.regular_hours  || 0,
      ot_hours:       wtc.ot_hours       || 0,
      markup_pct:     wtc.markup_pct     || 0,
      burden_rate:    wtc.prevailing_wage ? (wtc.pw_rate || 0) : (wtc.burden_rate || 0),
      ot_burden_rate: wtc.prevailing_wage ? (wtc.pw_ot_rate || 0) : (wtc.ot_burden_rate || 0),
    });
    const mats = (wtc.materials || []).reduce((s, i) => s + calcMaterialRow(i), 0);
    const trav = calcTravel(wtc.travel);
    const disc = wtc.discount || 0;
    return {
      labor:     acc.labor    + labor.total,
      materials: acc.materials + mats,
      travel:    acc.travel   + trav,
      discount:  acc.discount + disc,
    };
  }, { labor: 0, materials: 0, travel: 0, discount: 0 });

  const proposalPrice = totals.labor + totals.materials + totals.travel - totals.discount;

  // Combine all Sales SOWs
  const combinedSOW = wtcs
    .map((wtc, i) => {
      const header = wtcs.length > 1 ? `── Work Type ${i + 1} ──\n` : "";
      return header + (wtc.sales_sow || "").trim();
    })
    .filter(s => s.replace(/── Work Type \d+ ──\n/, "").trim())
    .join("\n\n");

  if (loading) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(15,20,35,0.7)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ background: C.linenCard, borderRadius: 16, padding: 40, fontSize: 14, color: C.textFaint }}>Loading WTC data…</div>
      </div>
    );
  }

  return (
    <div
      data-pdf-overlay data-pdf-printable
      style={{ position: "fixed", inset: 0, zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,20,35,0.7)", backdropFilter: "blur(4px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <style>{`
        @media print {
          html, body, #root {
            height: auto !important;
            overflow: visible !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          body > #root { display: contents !important; }
          [data-pdf-overlay] {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: auto !important;
            background: white !important;
            backdrop-filter: none !important;
            display: block !important;
            overflow: visible !important;
          }
          [data-pdf-modal-inner] {
            position: static !important;
            max-height: none !important;
            height: auto !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            width: 100% !important;
            border: none !important;
            display: block !important;
            overflow: visible !important;
          }
          [data-pdf-header] { display: none !important; }
          [data-regression-tracker] { display: none !important; }
          [data-pdf-body] {
            padding: 20px !important;
            height: auto !important;
            flex: none !important;
            overflow: visible !important;
          }
          @page { margin: 0.6in; size: letter; }
        }
      `}</style>
      <div data-pdf-modal-inner data-pdf-printable style={{ background: "white", borderRadius: 16, width: "min(860px,95vw)", maxHeight: "93vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 80px rgba(0,0,0,0.35)", overflow: "hidden" }}>

        {/* Modal header */}
        <div data-pdf-header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", borderBottom: "1px solid #E5E7EB", background: "#FAFAFA", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "#1976D2", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "white", fontSize: 16 }}>📄</span>
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>Proposal Preview</div>
              <div style={{ fontSize: 11, color: "#6B7280" }}>{wtcs.length} Work Type{wtcs.length !== 1 ? "s" : ""} · {money(proposalPrice)}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {view === "preview" && !sendDone && (
              <>
                {onInternalApprove && <button onClick={onInternalApprove} style={{ background: "none", border: "1.5px solid #4CAF50", borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600, color: "#4CAF50", cursor: "pointer", fontFamily: "inherit" }}>✓ Internal Approve</button>}
                <button onClick={() => window.print()} style={{ background: "none", border: "1.5px solid #E5E7EB", borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600, color: "#4B5563", cursor: "pointer", fontFamily: "inherit" }}>🖨 Print</button>
                {mode === "send" && proposal.status !== "Sold" && wtcs.length > 0 && wtcs.every(w => w.locked) && <button onClick={() => setView("send")} style={{ background: "#1976D2", border: "none", borderRadius: 7, padding: "7px 16px", fontSize: 12, fontWeight: 700, color: "white", cursor: "pointer", fontFamily: "inherit" }}>📨 Send to Customer →</button>}
                {mode === "send" && proposal.status !== "Sold" && (wtcs.length === 0 || !wtcs.every(w => w.locked)) && <span style={{ fontSize: 11, fontWeight: 700, color: "#e53935", fontFamily: "inherit", padding: "7px 12px" }}>Lock all WTCs to send</span>}
              </>
            )}
            {view === "send" && !sendDone && (
              <button onClick={() => setView("preview")} style={{ background: "none", border: "1.5px solid #E5E7EB", borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600, color: "#4B5563", cursor: "pointer", fontFamily: "inherit" }}>← Back to Preview</button>
            )}
            <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: "#9CA3AF", cursor: "pointer", padding: "0 4px", lineHeight: 1 }}>×</button>
          </div>
        </div>

        {/* Modal body */}
        <div data-pdf-body style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>

          {view === "preview" && (
            <div style={{ fontFamily: "Arial, sans-serif", color: "#1c1814", background: "white" }}>

              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", paddingBottom: 16, borderBottom: "4px solid #30cfac", marginBottom: 24 }}>
                <div>
                  <img src={COMPANY.logo_url || "/hdsp-logo.png"} alt={COMPANY.name} style={{ height: 60, marginBottom: 6 }} />
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#1c1814", letterSpacing: "0.02em", textTransform: "uppercase" }}>{COMPANY.name}</div>
                  <div style={{ fontSize: 12, color: "#4a4238", marginTop: 3 }}>{COMPANY.tagline}</div>
                </div>
                <div style={{ textAlign: "right", fontSize: 11, color: "#4a4238", lineHeight: 1.7 }}>
                  <div>{repContact.phone || COMPANY.phone}</div>
                  <div>{repContact.email || COMPANY.email}</div>
                  <div>{COMPANY.website}</div>
                  <div style={{ color: "#887c6e" }}>{COMPANY.license}</div>
                </div>
              </div>

              {/* Prepared For + Proposal # */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, paddingBottom: 20, borderBottom: "1px solid rgba(28,24,20,0.12)" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#1c1814", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Prepared For</div>
                  <div style={{ fontSize: 12, fontWeight: 400, color: "#887c6e" }}>{proposal.customer || "—"}</div>
                  {proposal.call_log?.customers?.business_address && (
                    <div style={{ fontSize: 11, fontWeight: 400, color: "#887c6e", marginTop: 2, lineHeight: 1.7 }}>
                      {proposal.call_log.customers.business_address}
                      {proposal.call_log.customers.business_city ? ", " + proposal.call_log.customers.business_city : ""}
                      {proposal.call_log.customers.business_state ? ", " + proposal.call_log.customers.business_state : ""}
                      {proposal.call_log.customers.business_zip ? " " + proposal.call_log.customers.business_zip : ""}
                    </div>
                  )}
                  {proposal.call_log?.jobsite_address && (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#1c1814", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Jobsite Address</div>
                      <div style={{ fontSize: 11, fontWeight: 400, color: "#887c6e", lineHeight: 1.7 }}>
                        {proposal.call_log.jobsite_address}
                        {proposal.call_log.jobsite_city ? ", " + proposal.call_log.jobsite_city : ""}
                        {proposal.call_log.jobsite_state ? ", " + proposal.call_log.jobsite_state : ""}
                        {proposal.call_log.jobsite_zip ? " " + proposal.call_log.jobsite_zip : ""}
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#1c1814", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Proposal #</div>
                  <div style={{ fontSize: 12, color: "#887c6e" }}><span style={{ fontWeight: 800, color: "#1c1814" }}>{(proposal.call_log?.display_job_number || "—").split(" - ")[0]}</span>{(() => { const djn = proposal.call_log?.display_job_number || ""; const idx = djn.indexOf(" - "); return idx > -1 ? " - " + djn.slice(idx + 3) : ""; })()}-P{proposal.proposal_number || 1}</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#1c1814", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 10, marginBottom: 4 }}>Date</div>
                  <div style={{ fontSize: 12, fontWeight: 400, color: "#887c6e" }}>{new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
                </div>
              </div>

              {/* Introduction */}
              {(proposal.intro || "").trim() && (
                <div style={{ marginBottom: 28 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#887c6e", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>Introduction</div>
                  <div style={{ border: "1.5px solid rgba(28,24,20,0.2)", borderRadius: 8, padding: "16px 18px", background: "white" }}>
                    <pre style={{ margin: 0, fontSize: 13, color: "#2d2720", lineHeight: 1.75, whiteSpace: "pre-wrap", fontFamily: "Arial, sans-serif" }}>{(proposal.intro || "").trim()}</pre>
                  </div>
                </div>
              )}

              {/* Scope of Work */}
              <div style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#887c6e", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>Scope of Work</div>
                {wtcs.filter(w => (w.sales_sow || "").trim()).length === 0 ? (
                  <div style={{ border: "1.5px solid rgba(28,24,20,0.2)", borderRadius: 8, padding: "16px 18px", background: "white" }}>
                    <div style={{ fontSize: 13, color: "#887c6e", fontStyle: "italic" }}>No scope of work written yet. Add it in the WTC tab.</div>
                  </div>
                ) : (
                  wtcs.filter(w => (w.sales_sow || "").trim()).map((wtc, i, arr) => {
                    const wtcLabor = calcLabor({
                      regular_hours: wtc.regular_hours || 0, ot_hours: wtc.ot_hours || 0,
                      markup_pct: wtc.markup_pct || 0,
                      burden_rate: wtc.prevailing_wage ? (wtc.pw_rate || 0) : (wtc.burden_rate || 0),
                      ot_burden_rate: wtc.prevailing_wage ? (wtc.pw_ot_rate || 0) : (wtc.ot_burden_rate || 0),
                    });
                    const wtcMats = (wtc.materials || []).reduce((s, item) => s + calcMaterialRow(item), 0);
                    const wtcTrav = calcTravel(wtc.travel);
                    const wtcTotal = wtcLabor.total + wtcMats + wtcTrav - (wtc.discount || 0);
                    return (
                      <div key={wtc.id} style={{ marginBottom: i < arr.length - 1 ? 24 : 0 }}>
                        {arr.length > 1 && (
                          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, marginTop: i > 0 ? 8 : 0 }}>
                            <div style={{ height: 3, flex: 1, background: "#30cfac", borderRadius: 2 }} />
                            <div style={{ fontSize: 14, fontWeight: 800, color: "#1c1814", letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap" }}>Work Type {i + 1}{wtc.work_types?.name ? ` — ${wtc.work_types.name}` : ""}</div>
                            <div style={{ height: 3, flex: 1, background: "#30cfac", borderRadius: 2 }} />
                          </div>
                        )}
                        <div style={{ border: "1.5px solid rgba(28,24,20,0.2)", borderRadius: 8, padding: "16px 18px", background: "white" }}>
                          <pre style={{ margin: 0, fontSize: 13, color: "#2d2720", lineHeight: 1.75, whiteSpace: "pre-wrap", fontFamily: "Arial, sans-serif" }}>{(wtc.sales_sow || "").trim()}</pre>
                        </div>
                        {arr.length > 1 && (
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, padding: "8px 18px", background: "rgba(48,207,172,0.08)", borderRadius: 6, border: "1px solid rgba(48,207,172,0.25)" }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#4a4238", letterSpacing: "0.06em", textTransform: "uppercase" }}>Work Type {i + 1}{wtc.work_types?.name ? ` — ${wtc.work_types.name}` : ""} Total</div>
                            <div style={{ fontSize: 16, fontWeight: 800, color: "#1c1814" }}>{money(wtcTotal)}</div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Proposal Total — with discount breakout when applicable */}
              {totals.discount > 0 ? (
                <div style={{ border: "2px solid #30cfac", borderRadius: 8, padding: "14px 20px", marginBottom: 28 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#4a4238", letterSpacing: "0.08em", textTransform: "uppercase" }}>Subtotal</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#1c1814" }}>{money(totals.labor + totals.materials + totals.travel)}</div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#1c1814", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      Discount{wtcs.some(w => w.discount_reason) ? ` — ${wtcs.map(w => w.discount_reason).filter(Boolean).join(", ")}` : ""}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#1c1814" }}>−{money(totals.discount)}</div>
                  </div>
                  <div style={{ borderTop: "1.5px solid rgba(28,24,20,0.15)", paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#4a4238", letterSpacing: "0.08em", textTransform: "uppercase" }}>Proposal Total</div>
                    <div style={{ fontSize: 26, fontWeight: 800, color: "#1c1814", letterSpacing: "-0.01em" }}>{money(proposalPrice)}</div>
                  </div>
                </div>
              ) : (
                <div style={{ border: "2px solid #30cfac", borderRadius: 8, padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#4a4238", letterSpacing: "0.08em", textTransform: "uppercase" }}>Proposal Total</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: "#1c1814", letterSpacing: "-0.01em" }}>{money(proposalPrice)}</div>
                </div>
              )}

              {/* Signature / Approval block */}
              {proposal.internal_approval ? (
                <div style={{ borderTop: "1.5px solid rgba(28,24,20,0.15)", paddingTop: 20 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#887c6e", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Internal Approval</div>
                  <div style={{ border: "1.5px solid rgba(48,207,172,0.3)", borderRadius: 8, padding: "16px 20px", background: "rgba(48,207,172,0.04)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 12 }}>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#887c6e", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Approved By</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#1c1814" }}>{proposal.approved_by || "—"}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#887c6e", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Date</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#1c1814" }}>{proposal.approved_at ? new Date(proposal.approved_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—"}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#887c6e", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Time</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#1c1814" }}>{proposal.approved_at ? new Date(proposal.approved_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—"}</div>
                      </div>
                    </div>
                    {proposal.approval_reason && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#887c6e", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Reason</div>
                        <div style={{ fontSize: 13, color: "#2d2720" }}>{proposal.approval_reason}</div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ borderTop: "1.5px solid rgba(28,24,20,0.15)", paddingTop: 20 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#887c6e", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 20 }}>Customer Acceptance</div>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 32, marginBottom: 16 }}>
                    <div>
                      <div style={{ borderBottom: "1.5px solid #2d2720", marginBottom: 6, height: 32 }} />
                      <div style={{ fontSize: 11, color: "#887c6e" }}>Authorized Signature</div>
                    </div>
                    <div>
                      <div style={{ borderBottom: "1.5px solid #2d2720", marginBottom: 6, height: 32 }} />
                      <div style={{ fontSize: 11, color: "#887c6e" }}>Date</div>
                    </div>
                  </div>
                  <div style={{ borderBottom: "1.5px solid #2d2720", marginBottom: 6, height: 32, width: "60%" }} />
                  <div style={{ fontSize: 11, color: "#887c6e", marginBottom: 20 }}>Printed Name</div>
                  <div style={{ fontSize: 11, color: "#887c6e", fontStyle: "italic", textAlign: "center" }}>
                    *This proposal is valid for 90 days from the date above.*
                  </div>
                </div>
              )}

            </div>
          )}

          {view === "send" && !sendDone && (
            <div style={{ maxWidth: 520, margin: "0 auto" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 6 }}>Send Proposal to Customer</div>
              <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 24 }}>Select a signer and optional viewers. All recipients will receive an email with the proposal link.</div>

              {/* Recipient picker */}
              <div style={{ background: "#F9FAFB", border: "1.5px solid #E5E7EB", borderRadius: 10, padding: "14px 16px", marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>Recipients</div>
                {contacts.length === 0 && (
                  <div style={{ fontSize: 12, color: "#e53935" }}>No contacts on file. Add a contact email to the customer record first.</div>
                )}
                {contacts.map(c => {
                  const isSigner = signerEmail === c.email;
                  const isViewer = viewerEmails.includes(c.email);
                  return (
                    <div key={c.email} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #E5E7EB" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{c.name || c.email}</div>
                        <div style={{ fontSize: 11, color: "#9CA3AF" }}>{c.email}{c.role ? ` · ${c.role}` : ""}</div>
                      </div>
                      <button
                        onClick={() => { setSignerEmail(c.email); setViewerEmails(v => v.filter(e => e !== c.email)); }}
                        style={{
                          padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                          background: isSigner ? "#30cfac" : "transparent", color: isSigner ? "#1c1814" : "#6B7280",
                          border: `1.5px solid ${isSigner ? "#30cfac" : "#D1D5DB"}`,
                        }}
                      >Signer</button>
                      <button
                        onClick={() => {
                          if (isSigner) return;
                          setViewerEmails(v => isViewer ? v.filter(e => e !== c.email) : [...v, c.email]);
                        }}
                        style={{
                          padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: isSigner ? "default" : "pointer", fontFamily: "inherit",
                          background: isViewer ? "#1c1814" : "transparent", color: isViewer ? "#30cfac" : "#6B7280",
                          border: `1.5px solid ${isViewer ? "#1c1814" : "#D1D5DB"}`, opacity: isSigner ? 0.3 : 1,
                        }}
                      >Viewer</button>
                    </div>
                  );
                })}
              </div>

              <div style={{ background: "#F9FAFB", border: "1.5px solid #E5E7EB", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 12, color: "#6B7280", wordBreak: "break-all" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Signing Link</div>
                {signingUrl}
              </div>
              {sendError && <div style={{ fontSize: 12, color: "#e53935", marginBottom: 12, background: "rgba(229,57,53,0.06)", border: "1px solid rgba(229,57,53,0.2)", borderRadius: 8, padding: "10px 14px" }}>{sendError}</div>}
              <button onClick={handleSend} disabled={sending || !signerEmail} style={{ width: "100%", background: sending || !signerEmail ? "#ccc" : "#30cfac", color: "#1c1814", border: "none", borderRadius: 8, padding: 13, fontSize: 14, fontWeight: 700, cursor: sending || !signerEmail ? "default" : "pointer", fontFamily: "inherit" }}>
                {sending ? "Sending…" : `Send to ${1 + viewerEmails.length} Recipient${viewerEmails.length > 0 ? "s" : ""}`}
              </button>
            </div>
          )}

          {sendDone && (
            <div style={{ textAlign: "center", padding: "40px 20px" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 8 }}>Proposal Sent</div>
              <div style={{ fontSize: 14, color: "#6B7280", marginBottom: 24 }}>The customer will receive an email with a link to review and sign.</div>
              <button onClick={onClose} style={{ background: "none", border: "1.5px solid #E5E7EB", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 600, color: "#4B5563", cursor: "pointer", fontFamily: "inherit" }}>Close</button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}





export default ProposalPDFModal;
