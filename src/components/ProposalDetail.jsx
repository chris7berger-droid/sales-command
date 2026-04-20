import { useEffect, useState } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import { fmt$, fmt$c, fmtD } from "../lib/utils";
import { calcLabor, calcMaterialRow, calcTravel, calcWtcPrice, calcWtcBreakdown } from "../lib/calc";
import { PROP_C } from "../lib/mockData";
import { getTenantConfig } from "../lib/config";
import WTCCalculator from "../pages/WTCCalculator";
import Btn from "./Btn";
import Pill from "./Pill";
import ProposalPDFModal from "./ProposalPDFModal";
import BillingScheduleSection from "./BillingScheduleSection";

function ProposalDetail({ p: pInit, onBack, onDeleted, teamMember, onNavigateJob, onNavigateInvoice }) {
  const [p, setP] = useState(pInit);
  const money = p.call_log?.show_cents ? fmt$c : fmt$;
  const [showWTC, setShowWTC] = useState(false);
const [activeWtcId, setActiveWtcId] = useState(null);
const [showPDF, setShowPDF] = useState(false);
const [pdfMode, setPdfMode] = useState("preview");
const [signatureInfo, setSignatureInfo] = useState(null);
const [wtcInitialTab, setWtcInitialTab] = useState(null);
const missingJobsite = !p.call_log?.jobsite_address;

const [wtcs, setWtcs] = useState([]);
const [signedPdfUrl, setSignedPdfUrl] = useState(null);
const [attachments, setAttachments] = useState([]);
const [proposalAttachments, setProposalAttachments] = useState([]);
const [uploadingPropAttach, setUploadingPropAttach] = useState(false);
const [expandedWtc, setExpandedWtc] = useState("auto");
const [showApproveModal, setShowApproveModal] = useState(false);
const [approveBy, setApproveBy] = useState(teamMember?.name || "");
const [approveReason, setApproveReason] = useState("");
const [allTeamMembers, setAllTeamMembers] = useState([]);
const [intro, setIntro] = useState(pInit.intro || "");
const [introLoaded, setIntroLoaded] = useState(!!pInit.intro);
const [introSaving, setIntroSaving] = useState(false);
const [introSaved, setIntroSaved] = useState(false);
const [recipients, setRecipients] = useState([]);
const [sendingToSchedule, setSendingToSchedule] = useState(false);
const [sentToSchedule, setSentToSchedule] = useState(false);
const [customerContacts, setCustomerContacts] = useState([]);
const [editingRecipient, setEditingRecipient] = useState(null);
const [contactDraft, setContactDraft] = useState({});
const [showAddPicker, setShowAddPicker] = useState(false);
const [newContactOpen, setNewContactOpen] = useState(false);
const [editingPrimary, setEditingPrimary] = useState(false);
const [primaryDraft, setPrimaryDraft] = useState("");
const [linkedInvoices, setLinkedInvoices] = useState([]);

useEffect(() => {
  (async () => {
    const { data } = await supabase.from("invoices").select("id").eq("proposal_id", p.id).is("deleted_at", null).order("sent_at", { ascending: false });
    setLinkedInvoices(data || []);
  })();
}, [p.id]);

useEffect(() => {
  supabase.from("team_members").select("id, name").eq("active", true).order("name").then(({ data }) => setAllTeamMembers(data || []));
  supabase.from("proposal_recipients").select("*, customer_contacts(id, role, is_primary)").eq("proposal_id", p.id).order("created_at").then(({ data }) => setRecipients(data || []));
  const custId = pInit.call_log?.customer_id;
  if (custId) {
    supabase.from("customer_contacts").select("*").eq("customer_id", custId).order("is_primary", { ascending: false }).order("name").then(({ data }) => setCustomerContacts(data || []));
  }
  // Check if already sent to Schedule Command
  if (pInit.status === "Sold") {
    supabase.from("jobs").select("job_id").eq("source_proposal_id", pInit.id).maybeSingle().then(({ data }) => { if (data) setSentToSchedule(true); });
  }
}, []);

const [defaultIntro, setDefaultIntro] = useState(`Thank you for the opportunity to provide this proposal for ${p.call_log?.job_name || p.customer || "your project"}. We are pleased to present the following scope of work and pricing for your review.`);

useEffect(() => {
  getTenantConfig().then(cfg => {
    if (cfg.default_proposal_intro) {
      const tmpl = cfg.default_proposal_intro.replace("{job_name}", p.call_log?.job_name || p.customer || "your project");
      setDefaultIntro(tmpl);
      if (!introLoaded && !intro) {
        setIntro(tmpl);
      }
    }
  });
}, []);

async function saveIntro() {
  setIntroSaving(true);
  await supabase.from("proposals").update({ intro }).eq("id", p.id);
  setIntroSaving(false);
  setIntroSaved(true);
  setTimeout(() => setIntroSaved(false), 2000);
}

// Auto-refresh when proposal is Sent (waiting for customer signature)
useEffect(() => {
  if (p.status !== "Sent") return;
  const interval = setInterval(async () => {
    const { data } = await supabase
      .from("proposals")
      .select("*, call_log(jobsite_address, jobsite_city, jobsite_state, jobsite_zip, display_job_number, customer_name, sales_name, job_name, customer_id, show_cents, is_change_order, co_number, customers(email, contact_email, business_address, business_city, business_state, business_zip))")
      .eq("id", p.id)
      .single();
    if (data && data.status !== p.status) setP(data);
  }, 10000);
  return () => clearInterval(interval);
}, [p.status, p.id]);

useEffect(() => {
  async function loadWtcs() {
    const { data } = await supabase
      .from("proposal_wtc")
      .select("*, work_types(name)")
      .eq("proposal_id", p.id)
      .order("created_at", { ascending: true });
    setWtcs(data || []);
  }
  loadWtcs();
}, [p.id]);


useEffect(() => {
  async function loadSignatureData() {
    const { data } = await supabase
      .from("proposal_signatures")
      .select("signer_name, signer_email, signed_at, pdf_url")
      .eq("proposal_id", p.id)
      .order("signed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.pdf_url) setSignedPdfUrl(data.pdf_url);
    if (data) setSignatureInfo(data);
  }
  loadSignatureData();
}, [p.id, p.status]);

useEffect(() => {
  if (!p.call_log_id) return;
  async function loadAttachments() {
    const { data, error } = await supabase.storage
      .from("job-attachments")
      .list(String(p.call_log_id));
    if (error || !data) return;
    setAttachments(
      data.map(file => {
        const { data: urlData } = supabase.storage
          .from("job-attachments")
          .getPublicUrl(`${p.call_log_id}/${file.name}`);
        const display = file.name.replace(/^\d+-/, "");
        return { name: display, url: urlData.publicUrl };
      })
    );
  }
  loadAttachments();
}, [p.call_log_id]);

// Proposal attachments (files sent with the proposal to the customer)
useEffect(() => {
  async function loadPropAttachments() {
    const prefix = `proposal-${p.id}`;
    const { data, error } = await supabase.storage.from("job-attachments").list(prefix);
    if (error || !data) return;
    setProposalAttachments(
      data.filter(f => f.name !== ".emptyFolderPlaceholder").map(file => {
        const { data: urlData } = supabase.storage.from("job-attachments").getPublicUrl(`${prefix}/${file.name}`);
        const display = file.name.replace(/^\d+-/, "");
        return { name: display, fullName: file.name, url: urlData.publicUrl };
      })
    );
  }
  loadPropAttachments();
}, [p.id]);

async function handlePropAttachUpload(e) {
  const files = e.target.files;
  if (!files || files.length === 0) return;
  setUploadingPropAttach(true);
  const prefix = `proposal-${p.id}`;
  for (const file of files) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storageName = `${Date.now()}-${safeName}`;
    await supabase.storage.from("job-attachments").upload(`${prefix}/${storageName}`, file, { upsert: false });
  }
  // Reload
  const { data } = await supabase.storage.from("job-attachments").list(prefix);
  if (data) {
    setProposalAttachments(
      data.filter(f => f.name !== ".emptyFolderPlaceholder").map(file => {
        const { data: urlData } = supabase.storage.from("job-attachments").getPublicUrl(`${prefix}/${file.name}`);
        const display = file.name.replace(/^\d+-/, "");
        return { name: display, fullName: file.name, url: urlData.publicUrl };
      })
    );
  }
  setUploadingPropAttach(false);
  e.target.value = "";
}

async function deletePropAttachment(fullName) {
  if (!window.confirm("Remove this attachment from the proposal?")) return;
  const prefix = `proposal-${p.id}`;
  await supabase.storage.from("job-attachments").remove([`${prefix}/${fullName}`]);
  setProposalAttachments(prev => prev.filter(a => a.fullName !== fullName));
}

  async function setJobWalkType(wtcId, currentVal, type) {
    const newVal = currentVal === type ? null : type;
    await supabase.from("proposal_wtc").update({ job_walk_type: newVal }).eq("id", wtcId);
    setWtcs(prev => prev.map(w => w.id === wtcId ? { ...w, job_walk_type: newVal } : w));
  }

  async function deleteWtc(wtcId) {
    if (!window.confirm("Delete this WTC? This cannot be undone.")) return;
    await supabase.from("proposal_wtc").delete().eq("id", wtcId);
    const { data: still } = await supabase.from("proposal_wtc").select("id").eq("id", wtcId).maybeSingle();
    if (still) { alert("Delete failed — you may not have permission."); return; }
    setWtcs(prev => prev.filter(w => w.id !== wtcId));
  }

  async function toggleWtcLock(wtcId) {
    const wtc = wtcs.find(w => w.id === wtcId);
    if (!wtc) return;
    const newLocked = !wtc.locked;
    // If locking, confirm the WTC checklist is complete enough
    if (newLocked) {
      const checks = getWtcChecks(wtc);
      const preChecks = checks.slice(0, 5); // work type, rates, labor, materials, size
      const incomplete = preChecks.filter(c => !c.done);
      if (incomplete.length > 0) {
        alert(`Cannot lock — incomplete: ${incomplete.map(c => c.l).join(", ")}`);
        return;
      }
    }
    await supabase.from("proposal_wtc").update({ locked: newLocked }).eq("id", wtcId);
    setWtcs(prev => prev.map(w => w.id === wtcId ? { ...w, locked: newLocked } : w));
    // Sync proposals.total
    const { data: allWtcs } = await supabase.from("proposal_wtc").select("*").eq("proposal_id", p.id);
    const proposalTotal = (allWtcs || []).reduce((sum, w) => sum + calcWtcPrice(w), 0);
    await supabase.from("proposals").update({ total: proposalTotal }).eq("id", p.id);
  }

  function openWtcTab(wtcId, tab) {
    setActiveWtcId(wtcId);
    setWtcInitialTab(tab);
    setShowWTC(true);
  }

  const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const custId = p.call_log?.customer_id;

  async function savePrimaryEmail() {
    if (primaryDraft && !isValidEmail(primaryDraft)) { alert("Invalid email address"); return; }
    await supabase.from("customers").update({ email: primaryDraft, contact_email: primaryDraft }).eq("id", custId);
    setP(prev => ({ ...prev, call_log: { ...prev.call_log, customers: { ...prev.call_log?.customers, email: primaryDraft, contact_email: primaryDraft } } }));
    setEditingPrimary(false);
  }

  async function reloadRecipients() {
    const { data } = await supabase.from("proposal_recipients").select("*, customer_contacts(id, role, is_primary)").eq("proposal_id", p.id).order("created_at");
    setRecipients(data || []);
  }

  async function reloadCustomerContacts() {
    if (!custId) return;
    const { data } = await supabase.from("customer_contacts").select("*").eq("customer_id", custId).order("is_primary", { ascending: false }).order("name");
    setCustomerContacts(data || []);
  }

  async function saveRecipient(id) {
    const draft = contactDraft;
    if (draft.email && !isValidEmail(draft.email)) {
      alert("Invalid email address");
      return;
    }
    const r = recipients.find(x => x.id === id);
    await supabase.from("proposal_recipients").update({ contact_name: draft.name, contact_email: draft.email, phone: draft.phone }).eq("id", id);
    if (r?.customer_contact_id) {
      await supabase.from("customer_contacts").update({ name: draft.name, email: draft.email, phone: draft.phone, role: draft.role }).eq("id", r.customer_contact_id);
    }
    setEditingRecipient(null);
    setContactDraft({});
    await Promise.all([reloadRecipients(), reloadCustomerContacts()]);
  }

  async function pickExistingContact(c) {
    if (recipients.some(r => r.customer_contact_id === c.id)) return;
    await supabase.from("proposal_recipients").insert({
      proposal_id: p.id,
      contact_name: c.name || "",
      contact_email: c.email || "",
      phone: c.phone || "",
      role: "viewer",
      customer_contact_id: c.id,
    });
    await reloadRecipients();
  }

  async function createNewRecipient() {
    if (!custId) return;
    const draft = contactDraft;
    if (draft.email && !isValidEmail(draft.email)) {
      alert("Invalid email address");
      return;
    }
    const emailLc = (draft.email || "").trim().toLowerCase();
    let contactId = null;
    if (emailLc) {
      const existing = customerContacts.find(c => (c.email || "").trim().toLowerCase() === emailLc);
      if (existing) contactId = existing.id;
    }
    if (!contactId) {
      const { data: newC } = await supabase.from("customer_contacts").insert({
        customer_id: custId,
        name: draft.name || "",
        email: draft.email || "",
        phone: draft.phone || "",
        role: draft.role || "Project Manager",
      }).select().single();
      if (newC) contactId = newC.id;
    }
    if (recipients.some(r => r.customer_contact_id === contactId)) {
      setNewContactOpen(false);
      setContactDraft({});
      await reloadCustomerContacts();
      return;
    }
    await supabase.from("proposal_recipients").insert({
      proposal_id: p.id,
      contact_name: draft.name || "",
      contact_email: draft.email || "",
      phone: draft.phone || "",
      role: "viewer",
      customer_contact_id: contactId,
    });
    setNewContactOpen(false);
    setContactDraft({});
    await Promise.all([reloadRecipients(), reloadCustomerContacts()]);
  }

  async function deleteRecipient(id) {
    if (!window.confirm("Remove this recipient from the proposal? (The contact stays on the customer file.)")) return;
    await supabase.from("proposal_recipients").delete().eq("id", id);
    await reloadRecipients();
  }

  async function saveToCustomerFile(id) {
    if (!custId) return;
    const r = recipients.find(x => x.id === id);
    if (!r) return;
    const emailLc = (r.contact_email || "").trim().toLowerCase();
    let contactId = null;
    if (emailLc) {
      const existing = customerContacts.find(c => (c.email || "").trim().toLowerCase() === emailLc);
      if (existing) contactId = existing.id;
    }
    if (!contactId) {
      const { data: newC } = await supabase.from("customer_contacts").insert({
        customer_id: custId,
        name: r.contact_name || "",
        email: r.contact_email || "",
        phone: r.phone || "",
        role: "Project Manager",
      }).select().single();
      if (newC) contactId = newC.id;
    }
    if (contactId) {
      await supabase.from("proposal_recipients").update({ customer_contact_id: contactId }).eq("id", id);
    }
    await Promise.all([reloadRecipients(), reloadCustomerContacts()]);
  }

  async function toggleSigner(id) {
    const r = recipients.find(x => x.id === id);
    if (!r) return;
    if (r.role === "signer") {
      await supabase.from("proposal_recipients").update({ role: "viewer" }).eq("id", id);
    } else {
      await supabase.from("proposal_recipients").update({ role: "viewer" }).eq("proposal_id", p.id).eq("role", "signer");
      await supabase.from("proposal_recipients").update({ role: "signer" }).eq("id", id);
    }
    await reloadRecipients();
  }

  function getWtcChecks(wtc) {
    const travelData = wtc.travel || {};
    const hasTravelEntries = Object.values(travelData).some(v => typeof v === "number" && v > 0);
    const allWtcsLocked = wtcs.length > 0 && wtcs.every(w => w.locked);
    return [
      { l: "Work type selected",       done: !!wtc.work_type_id,                                    tab: "bidding" },
      { l: "Rates & dates set",        done: !!(wtc.start_date && wtc.end_date),                    tab: "bidding" },
      { l: "Labor entered",            done: (wtc.regular_hours || 0) > 0,                          tab: "labor" },
      { l: "Materials or SOW",         done: (Array.isArray(wtc.materials) && wtc.materials.length > 0) || !!(wtc.sales_sow), tab: "materials" },
      { l: "Size / unit filled in",    done: !!(wtc.size && wtc.unit),                              tab: "sow" },
      { l: "Locked",                   done: !!wtc.locked,                                           tab: "summary" },
      { l: "Proposal built",           done: allWtcsLocked },
      { l: "Proposal sent",            done: ["Sent", "Sold"].includes(p.status) },
      { l: "Proposal approved",        done: p.status === "Sold" },
    ];
  }

  const canDelete = teamMember && (["Admin","Manager"].includes(teamMember.role) || teamMember.name === p.call_log?.sales_name);
  async function handleDelete() {
    // Check for linked active invoices first
    const { data: invoices } = await supabase.from("invoices").select("id").eq("proposal_id", p.id).is("deleted_at", null);
    if (invoices && invoices.length > 0) {
      alert(`This proposal has ${invoices.length} invoice${invoices.length > 1 ? "s" : ""} linked to it. Please delete the invoice${invoices.length > 1 ? "s" : ""} first.`);
      return;
    }
    if (!window.confirm("Delete this proposal? This cannot be undone.")) return;
    const { error } = await supabase.from("proposals").update({ deleted_at: new Date().toISOString() }).eq("id", p.id);
    if (error) { alert(error.message); return; }
    onDeleted && onDeleted();
  }

  async function handlePullBack() {
    const { data: invoices } = await supabase.from("invoices").select("id").eq("proposal_id", p.id).is("deleted_at", null);
    if (invoices && invoices.length > 0) {
      alert(`This proposal has ${invoices.length} invoice${invoices.length > 1 ? "s" : ""} linked to it. Delete the invoice${invoices.length > 1 ? "s" : ""} before pulling back.`);
      return;
    }
    if (!window.confirm("Pull back this proposal? It will return to Draft status and WTCs will be unlocked for editing.")) return;
    // Clear old signatures
    await supabase.from("proposal_signatures").delete().eq("proposal_id", p.id);
    // Unlock all WTCs
    await supabase.from("proposal_wtc").update({ locked: false }).eq("proposal_id", p.id);
    // Reset proposal
    await supabase.from("proposals").update({
      status: "Draft", approved_at: null, sent_at: null, sent_to_email: null,
      internal_approval: false, approved_by: null, approval_reason: null,
    }).eq("id", p.id);
    // Reset call log stage
    if (p.call_log_id) {
      await supabase.from("call_log").update({ stage: "Wants Bid" }).eq("id", p.call_log_id);
    }
    // Refresh
    const { data } = await supabase.from("proposals").select("*, call_log(jobsite_address, jobsite_city, jobsite_state, jobsite_zip, display_job_number, customer_name, sales_name, job_name, customer_id, show_cents, is_change_order, co_number, customers(email, contact_email, business_address, business_city, business_state, business_zip))").eq("id", p.id).single();
    if (data) setP(data);
    const { data: wtcData } = await supabase.from("proposal_wtc").select("*, work_types(name)").eq("proposal_id", p.id).order("created_at", { ascending: true });
    setWtcs(wtcData || []);
    setSignedPdfUrl(null);
  }

  async function handleSendToSchedule() {
    setSendingToSchedule(true);
    try {
      // Check if already sent
      const { data: existing } = await supabase.from("jobs").select("job_id").eq("source_proposal_id", p.id).maybeSingle();
      if (existing) { alert("This proposal has already been sent to Schedule Command."); setSentToSchedule(true); setSendingToSchedule(false); return; }

      // Block if invoiced — don't schedule work that's already been billed
      const { data: invoices } = await supabase.from("invoices").select("id").eq("proposal_id", p.id).limit(1);
      if (invoices && invoices.length > 0) { alert("This proposal has already been invoiced. Cannot send to Schedule Command."); setSendingToSchedule(false); return; }

      // Gather WTC data
      const { data: wtcData } = await supabase.from("proposal_wtc").select("*, work_types(name, cost_code)").eq("proposal_id", p.id).order("created_at", { ascending: true });
      const wtcList = wtcData || [];

      // Build work type string (e.g. "Epoxy,Caulking")
      const workTypeNames = wtcList.map(w => w.work_types?.name).filter(Boolean);
      const workType = workTypeNames.join(",");

      // Merge field_sow from all WTCs
      const fieldSow = wtcList.flatMap(w => w.field_sow || []);

      // Combine sales_sow text
      const salesSow = wtcList.map((w, i) => {
        const label = wtcList.length > 1 ? `WTC ${i + 1} — ${w.work_types?.name || ""}:\n` : "";
        return label + (w.sales_sow || "");
      }).filter(s => s.trim()).join("\n\n");

      // Use dates from first WTC that has them
      const wtcWithDates = wtcList.find(w => w.start_date);
      const startDate = wtcWithDates?.start_date || null;
      const endDate = wtcWithDates?.end_date || null;

      // Prevailing wage — yes if any WTC is PW
      const hasPW = wtcList.some(w => w.prevailing_wage);

      // Size — sum across WTCs, use unit from first
      const totalSize = wtcList.reduce((sum, w) => sum + (parseFloat(w.size) || 0), 0);
      const sizeUnit = wtcList.find(w => w.unit)?.unit || "SF";

      // Amount as plain number string (Jobs view uses parseFloat)
      const amount = p.total ? String(Number(p.total)) : "";

      const row = {
        call_log_id: p.call_log_id || null,
        amount,
        work_type: workType,
        field_sow: fieldSow.length > 0 ? fieldSow : null,
        sow: salesSow || null,
        scheduled_start: startDate,
        scheduled_end: endDate,
        start_date: startDate,
        end_date: endDate,
        status: "Parked",
        size: totalSize || null,
        size_unit: sizeUnit,
        source_proposal_id: p.id,
        source_call_log_id: p.call_log_id || null,
        // Legacy fields kept for backward compat during migration
        job_num: p.call_log?.display_job_number || "NEW",
        job_name: p.call_log?.job_name || p.customer || "Untitled",
        prevailing_wage: hasPW ? "Yes" : "No",
        proposal_number: p.proposal_number || 1,
        is_change_order: p.call_log?.is_change_order || false,
        co_number: p.call_log?.co_number || null,
      };

      const { data: inserted, error } = await supabase.from("jobs").insert([row]).select("job_id, status");
      console.log("[SendToSchedule] inserted:", inserted);
      if (error) {
        if (error.code === "23505") { alert("This proposal has already been sent to Schedule Command."); setSentToSchedule(true); }
        else { alert("Error sending to Schedule: " + error.message); }
        setSendingToSchedule(false);
        return;
      }

      // Create materials rows from WTC materials
      const newJobId = inserted?.[0]?.job_id;
      if (newJobId) {
        const matRows = [];
        let ordinal = 0;
        for (const wtc of wtcList) {
          const mats = wtc.materials || [];
          for (const m of mats) {
            const name = [m.product, m.kit_size ? `(${m.kit_size})` : ""].filter(Boolean).join(" ");
            const notes = [
              m.qty ? `Qty: ${m.qty}` : null,
              m.supplier ? `Supplier: ${m.supplier}` : null,
            ].filter(Boolean).join(" | ");
            matRows.push({ job_id: newJobId, ordinal, name, status: "Not Ordered", notes: notes || null });
            ordinal++;
          }
        }
        if (matRows.length > 0) {
          const { error: matErr } = await supabase.from("materials").insert(matRows);
          if (matErr) console.error("[SendToSchedule] materials insert error:", matErr);
        }
      }

      // Update call_log stage to Parked
      if (p.call_log_id) {
        await supabase.from("call_log").update({ stage: "Parked" }).eq("id", p.call_log_id);
      }

      setSentToSchedule(true);
    } catch (e) {
      alert("Error: " + e.message);
    }
    setSendingToSchedule(false);
  }

  async function handleInternalApprove() {
    if (!approveBy.trim()) { alert("Approved By is required."); return; }
    if (!approveReason.trim()) { alert("Reason is required."); return; }
    await supabase.from("proposals").update({
      status: "Sold",
      approved_at: new Date().toISOString(),
      internal_approval: true,
      approved_by: approveBy.trim(),
      approval_reason: approveReason.trim(),
    }).eq("id", p.id);
    if (p.call_log_id) {
      await supabase.from("call_log").update({ stage: "Sold" }).eq("id", p.call_log_id);
      // Sync job to QuickBooks (skip if test job)
      const isTest = (p.call_log?.job_name || "").toLowerCase().includes("test");
      !isTest && supabase.functions.invoke("qb-create-job", { body: { callLogId: p.call_log_id } })
        .then(r => { if (r.data?.error) console.warn("QB sync:", r.data.error); else console.log("QB job created:", r.data); })
        .catch(e => console.warn("QB sync failed:", e.message));
    }
    // Refresh
    const { data } = await supabase.from("proposals").select("*, call_log(jobsite_address, jobsite_city, jobsite_state, jobsite_zip, display_job_number, customer_name, sales_name, job_name, customer_id, show_cents, is_change_order, co_number, customers(email, contact_email, business_address, business_city, business_state, business_zip))").eq("id", p.id).single();
    if (data) setP(data);
    setShowApproveModal(false);
    setApproveReason("");
  }

if (showWTC) return <WTCCalculator proposalId={p.id} wtcId={activeWtcId} initialTab={wtcInitialTab} onBackToList={onBack} onClose={async (openPDF = false) => { const { data } = await supabase.from("proposals").select("*, call_log(jobsite_address, jobsite_city, jobsite_state, jobsite_zip, display_job_number, customer_name, sales_name, job_name, customer_id, show_cents, is_change_order, co_number, customers(email, contact_email, business_address, business_city, business_state, business_zip))").eq("id", p.id).single(); if (data) setP(data); setShowWTC(false); setActiveWtcId(null); setWtcInitialTab(null); const { data: wtcData } = await supabase.from("proposal_wtc").select("*, work_types(name)").eq("proposal_id", p.id).order("created_at", { ascending: true }); setWtcs(wtcData || []); if (openPDF) { setPdfMode("send"); setShowPDF(true); } }} />;  if (showPDF) return <ProposalPDFModal key={p.id + '-pdf'} proposal={p} mode={pdfMode} onClose={async () => { setShowPDF(false); const { data } = await supabase.from("proposals").select("*, call_log(jobsite_address, jobsite_city, jobsite_state, jobsite_zip, display_job_number, customer_name, sales_name, job_name, customer_id, show_cents, is_change_order, co_number, customers(email, contact_email, business_address, business_city, business_state, business_zip))").eq("id", p.id).single(); if (data) setP(data); }} onInternalApprove={p.status === "Sent" ? async () => { setShowPDF(false); const { data } = await supabase.from("proposals").select("*, call_log(jobsite_address, jobsite_city, jobsite_state, jobsite_zip, display_job_number, customer_name, sales_name, job_name, customer_id, show_cents, is_change_order, co_number, customers(email, contact_email, business_address, business_city, business_state, business_zip))").eq("id", p.id).single(); if (data) setP(data); setShowApproveModal(true); } : undefined} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>

      {missingJobsite && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", background: "rgba(230,168,0,0.1)", border: "1.5px solid rgba(230,168,0,0.35)", borderRadius: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#7a5800", fontFamily: F.ui }}>Job site address required before this proposal can be built</div>
              <div style={{ fontSize: 12, color: "#a07800", fontFamily: F.ui, marginTop: 2 }}>Add the job site address to the linked call log record to continue.</div>
            </div>
          </div>
          <Btn sz="sm" v="secondary" onClick={onBack}>← Edit Job</Btn>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: C.tealDark, fontWeight: 800, fontSize: 12.5, padding: 0, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          ← Back
        </button>
        {p.call_log_id && onNavigateJob && (
          <button onClick={() => onNavigateJob(p.call_log_id)} title="Open Call Log entry" style={{ background: C.linenDeep, border: `1px solid ${C.borderStrong}`, cursor: "pointer", color: C.tealDark, fontWeight: 800, fontSize: 11, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", padding: "6px 12px", borderRadius: 6 }}>
            Job →
          </button>
        )}
        {linkedInvoices.length === 1 && onNavigateInvoice && (
          <button onClick={() => onNavigateInvoice(linkedInvoices[0].id)} title="Open Invoice" style={{ background: C.linenDeep, border: `1px solid ${C.borderStrong}`, cursor: "pointer", color: C.tealDark, fontWeight: 800, fontSize: 11, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", padding: "6px 12px", borderRadius: 6 }}>
            Invoice →
          </button>
        )}
        {linkedInvoices.length > 1 && onNavigateInvoice && (
          <span style={{ fontSize: 11, fontWeight: 700, color: C.textFaint, fontFamily: F.ui }}>
            {linkedInvoices.length} invoices — see below
          </span>
        )}
        <div style={{ width: 1, height: 18, background: C.border }} />
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Proposal {p.call_log?.display_job_number || p.id} P{p.proposal_number || 1}

        </h2>
        <Pill label={p.status} cm={PROP_C} />
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {canDelete && (
            <Btn sz="sm" v="ghost" onClick={handleDelete} style={{ color: C.red, borderColor: C.red }}>🗑 Delete</Btn>
          )}
          {(p.status === "Sent" || p.status === "Sold") && (
            <Btn sz="sm" v="ghost" onClick={handlePullBack} style={{ color: C.amber, borderColor: C.amber }}>↩ Pull Back</Btn>
          )}
          {p.status === "Sold" && (
            <Btn sz="sm" v="ghost" onClick={handleSendToSchedule} disabled={sendingToSchedule || sentToSchedule}
              style={{ color: sentToSchedule ? C.textFaint : C.teal, borderColor: sentToSchedule ? C.border : C.teal }}>
              {sentToSchedule ? "✓ Sent to Schedule" : sendingToSchedule ? "Sending..." : "Send to Schedule"}
            </Btn>
          )}
          {p.status !== "Sold" && (
            <Btn sz="sm" v="ghost" onClick={() => setShowApproveModal(true)} style={{ color: C.green, borderColor: C.green }}>✓ Internal Approve</Btn>
          )}
          <Btn sz="sm" v="ghost" onClick={() => { setPdfMode("preview"); setShowPDF(true); }}>Generate PDF</Btn>
          {p.status !== "Sold" && p.status !== "Sent" && wtcs.length > 0 && wtcs.every(w => w.locked) && <Btn sz="sm" onClick={() => { setPdfMode("send"); setShowPDF(true); }}>Send Proposal</Btn>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: 20 }}>
            <div style={{ fontWeight: 800, fontSize: 12.5, color: C.textHead, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 14 }}>Work Type Calculators</div>
            {wtcs.length === 0 && (
              <div style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui, padding: "10px 0" }}>No work types yet.</div>
            )}
            {wtcs.map((wtc, wtcIdx) => {
              const checks = getWtcChecks(wtc);
              const pct = Math.round((checks.filter(c => c.done).length / checks.length) * 100);
              const price = calcWtcPrice(wtc);
              const wtcLabel = `WTC ${wtcIdx + 1}`;
              const typeName = wtc.work_types?.name;
              const isExpanded = expandedWtc === wtc.id || (expandedWtc === "auto" && wtcs.length === 1);
              return (
                <div key={wtc.id} style={{ background: C.linen, border: `1px solid ${wtc.locked ? C.border : (C.amber || "#e6a800")}`, borderLeft: wtc.locked ? `1px solid ${C.border}` : `4px solid ${C.amber || "#e6a800"}`, borderRadius: 8, padding: "14px 16px", marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 15, color: C.textHead, fontFamily: F.display }}>
                        {wtcLabel}{typeName ? ` — ${typeName}` : ""}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.textBody, fontFamily: F.ui, marginTop: 4 }}>{money(price)}</div>
                      {wtc.start_date && wtc.end_date && (
                        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, fontFamily: F.ui }}>
                          <span style={{ color: C.textFaint }}>Start</span> {fmtD(wtc.start_date)} — <span style={{ color: C.textFaint }}>End</span> {fmtD(wtc.end_date)}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: C.textFaint, marginTop: 2, fontFamily: F.ui }}>Created {fmtD(wtc.created_at?.slice(0,10))}</div>
                    </div>
                    <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, position: "relative" }}>
                      <div style={{ fontSize: 11, color: wtc.locked ? C.green : C.amber, fontWeight: 700, fontFamily: F.ui }}>{wtc.locked ? "🔒 Locked" : "⏳ In Progress"}</div>
                      <button onClick={() => setExpandedWtc(expandedWtc === `progress-${wtc.id}` ? null : `progress-${wtc.id}`)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: pct === 100 ? C.green : C.teal, fontFamily: "Barlow Condensed, sans-serif", background: C.dark, borderRadius: 6, padding: "3px 10px", letterSpacing: "0.08em" }}>{pct}%</span>
                      </button>
                      {expandedWtc === `progress-${wtc.id}` && (
                        <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 6, background: C.dark, borderRadius: 10, padding: "14px 18px", boxShadow: "0 8px 32px rgba(0,0,0,0.4)", zIndex: 100, width: 220, textAlign: "left" }}>
                          <div style={{ fontSize: 11, fontWeight: 800, color: C.teal, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>WTC Progress</div>
                          {checks.map((c, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12, fontFamily: F.ui, color: c.done ? C.teal : "rgba(255,255,255,0.4)" }}>
                              <span style={{ fontSize: 13 }}>{c.done ? "✓" : "○"}</span>
                              <span style={{ fontWeight: c.done ? 600 : 400 }}>{c.l}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                    <Btn sz="sm" v="secondary" onClick={() => { setActiveWtcId(wtc.id); setShowWTC(true); }}>Edit WTC</Btn>
                    <button onClick={() => setExpandedWtc(isExpanded ? null : wtc.id)} style={{
                      background: "none", border: `1px solid ${C.borderStrong}`, borderRadius: 6, padding: "4px 12px",
                      fontSize: 11, fontWeight: 700, color: C.textFaint, cursor: "pointer", fontFamily: F.display,
                      letterSpacing: "0.05em", textTransform: "uppercase",
                    }}>{isExpanded ? "Hide Checklist" : "Checklist"}</button>
                    <button onClick={() => toggleWtcLock(wtc.id)} style={{
                      background: wtc.locked ? C.green : "none", border: `1px solid ${wtc.locked ? C.green : (C.amber || "#e6a800")}`, borderRadius: 6, padding: "4px 12px",
                      fontSize: 11, fontWeight: 700, color: wtc.locked ? C.dark : (C.amber || "#e6a800"), cursor: "pointer", fontFamily: F.display,
                      letterSpacing: "0.05em", textTransform: "uppercase",
                    }}>{wtc.locked ? "Locked" : "Lock"}</button>
                    <button onClick={() => deleteWtc(wtc.id)} style={{
                      background: "none", border: `1px solid ${C.red || "#e53935"}`, borderRadius: 6, padding: "4px 10px",
                      fontSize: 11, fontWeight: 700, color: C.red || "#e53935", cursor: "pointer", fontFamily: F.display,
                      letterSpacing: "0.05em", textTransform: "uppercase", marginLeft: "auto",
                    }}>Delete</button>
                  </div>
                  {isExpanded && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                      <div style={{ height: 4, background: C.border, borderRadius: 4, marginBottom: 12 }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: pct === 100 ? C.green : C.teal, borderRadius: 4, transition: "width 0.3s" }} />
                      </div>
                      {checks.map((c, i) => (
                        <div key={i} style={{ padding: "6px 0", borderBottom: i < checks.length - 1 ? `1px solid ${C.border}` : "none" }}>
                          <div
                            onClick={() => c.tab && openWtcTab(wtc.id, c.tab)}
                            style={{ display: "flex", alignItems: "center", gap: 10, cursor: c.tab ? "pointer" : "default" }}
                          >
                            <div
                              onClick={c.custom && c.done ? (e) => { e.stopPropagation(); setJobWalkType(wtc.id, wtc.job_walk_type, wtc.job_walk_type); } : undefined}
                              style={{ width: 18, height: 18, borderRadius: "50%", flexShrink: 0, background: c.done ? C.teal : C.linen, border: `1.5px solid ${c.done ? C.teal : C.borderStrong}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: c.custom && c.done ? "pointer" : undefined }}
                            >
                              {c.done && <span style={{ fontSize: 10, color: C.dark, fontWeight: 900 }}>✓</span>}
                            </div>
                            <span style={{ fontSize: 12.5, color: c.done ? C.textBody : C.textFaint, fontWeight: c.done ? 600 : 400, fontFamily: F.ui, flex: 1 }}>{c.l}</span>
                            {c.tab && <span style={{ fontSize: 11, color: C.textFaint }}>›</span>}
                          </div>
                          {c.custom && (
                            <div style={{ display: "flex", gap: 6, marginTop: 6, marginLeft: 28 }}>
                              {[["job_walk", "Job Walk"], ["bid_off_plans", "Bid Off Plans"]].map(([val, label]) => {
                                const on = wtc.job_walk_type === val;
                                return (
                                  <button key={val} onClick={() => setJobWalkType(wtc.id, wtc.job_walk_type, val)} style={{
                                    padding: "4px 12px", borderRadius: 20, fontSize: 10.5, fontWeight: 700,
                                    fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase",
                                    cursor: "pointer", border: `1.5px solid ${on ? C.teal : C.borderStrong}`,
                                    background: on ? C.dark : "transparent", color: on ? C.teal : C.textFaint,
                                    transition: "all 0.12s",
                                  }}>{label}</button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <Btn sz="sm" v="ghost" onClick={() => { setActiveWtcId(null); setShowWTC(true); }}>+ Add Work Type</Btn>
          </div>

          {/* Recipients */}
          <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: 20 }}>
            <div style={{ fontWeight: 800, fontSize: 12.5, color: C.textHead, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>Recipients</div>
            {(() => {
              const cust = p.call_log?.customers;
              const custName = p.call_log?.customer_name || p.customer || "";
              const custEmail = cust?.contact_email || cust?.email || "";
              return (
                <>
                  {/* Primary customer contact */}
                  <div style={{ padding: "10px 12px", background: C.linen, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 6 }}>
                    {editingPrimary ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.textHead, fontFamily: F.ui }}>{custName}</div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input value={primaryDraft} onChange={e => setPrimaryDraft(e.target.value)} placeholder="Email" style={{ flex: 1, padding: "6px 8px", fontSize: 12, fontFamily: F.ui, border: `1px solid ${C.borderStrong}`, borderRadius: 5, background: C.linenDeep, color: C.textBody, WebkitAppearance: "none" }} />
                          <Btn sz="sm" onClick={savePrimaryEmail}>Save</Btn>
                          <Btn sz="sm" v="ghost" onClick={() => setEditingPrimary(false)}>Cancel</Btn>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: C.textHead, fontFamily: F.ui }}>{custName}</div>
                          <div style={{ fontSize: 12, color: custEmail && !isValidEmail(custEmail) ? (C.red || "#e53935") : C.textMuted, fontFamily: F.ui, marginTop: 1 }}>
                            {custEmail || <span style={{ color: C.textFaint, fontStyle: "italic" }}>No email on file</span>}
                            {custEmail && !isValidEmail(custEmail) && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700 }}>Invalid</span>}
                          </div>
                        </div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: C.teal, background: C.dark, borderRadius: 6, padding: "3px 10px", fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase" }}>Primary</div>
                        <button onClick={() => { setPrimaryDraft(custEmail); setEditingPrimary(true); }} style={{ background: "none", border: `1px solid ${C.borderStrong}`, borderRadius: 5, padding: "3px 8px", fontSize: 10, fontWeight: 700, color: C.textMuted, cursor: "pointer", fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>Edit</button>
                      </div>
                    )}
                  </div>

                  {/* Additional recipients */}
                  {recipients.map(r => {
                    const isEditing = editingRecipient === r.id;
                    const isSigner = r.role === "signer";
                    const custRole = r.customer_contacts?.role || "Contact";
                    const name = r.contact_name || "";
                    const email = r.contact_email || "";
                    const phone = r.phone || "";
                    return (
                      <div key={r.id} style={{ padding: "10px 12px", background: C.linen, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 6 }}>
                        {isEditing ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <div style={{ display: "flex", gap: 6 }}>
                              <input value={contactDraft.name || ""} onChange={e => setContactDraft(d => ({ ...d, name: e.target.value }))} placeholder="Name" style={{ flex: 1, padding: "6px 8px", fontSize: 12, fontFamily: F.ui, border: `1px solid ${C.borderStrong}`, borderRadius: 5, background: C.linenDeep, color: C.textBody, WebkitAppearance: "none" }} />
                              <select value={contactDraft.role || "Project Manager"} onChange={e => setContactDraft(d => ({ ...d, role: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12, fontFamily: F.ui, border: `1px solid ${C.borderStrong}`, borderRadius: 5, background: C.linenDeep, color: C.textBody, WebkitAppearance: "none" }}>
                                <option>Project Manager</option>
                                <option>Office Manager</option>
                                <option>Billing Contact</option>
                              </select>
                            </div>
                            <div style={{ display: "flex", gap: 6 }}>
                              <input value={contactDraft.email || ""} onChange={e => setContactDraft(d => ({ ...d, email: e.target.value }))} placeholder="Email" style={{ flex: 1, padding: "6px 8px", fontSize: 12, fontFamily: F.ui, border: `1px solid ${C.borderStrong}`, borderRadius: 5, background: C.linenDeep, color: C.textBody, WebkitAppearance: "none" }} />
                              <input value={contactDraft.phone || ""} onChange={e => setContactDraft(d => ({ ...d, phone: e.target.value }))} placeholder="Phone" style={{ flex: 0.7, padding: "6px 8px", fontSize: 12, fontFamily: F.ui, border: `1px solid ${C.borderStrong}`, borderRadius: 5, background: C.linenDeep, color: C.textBody, WebkitAppearance: "none" }} />
                            </div>
                            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                              <Btn sz="sm" v="ghost" onClick={() => { setEditingRecipient(null); setContactDraft({}); }}>Cancel</Btn>
                              <Btn sz="sm" onClick={() => saveRecipient(r.id)}>Save</Btn>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: C.textHead, fontFamily: F.ui }}>{name || <span style={{ color: C.textFaint, fontStyle: "italic" }}>No name</span>}</div>
                              <div style={{ fontSize: 12, color: email && !isValidEmail(email) ? (C.red || "#e53935") : C.textMuted, fontFamily: F.ui, marginTop: 1 }}>
                                {email || <span style={{ color: C.textFaint, fontStyle: "italic" }}>No email</span>}
                                {email && !isValidEmail(email) && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700 }}>Invalid</span>}
                              </div>
                              {phone && <div style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui, marginTop: 1 }}>{phone}</div>}
                            </div>
                            <button onClick={() => toggleSigner(r.id)} title={isSigner ? "Unset as signer" : "Set as signer"} style={{ fontSize: 10, fontWeight: 700, color: isSigner ? C.teal : C.textMuted, background: isSigner ? C.dark : "none", border: isSigner ? `1px solid ${C.dark}` : `1px solid ${C.borderStrong}`, borderRadius: 6, padding: "3px 10px", fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", whiteSpace: "nowrap" }}>{isSigner ? "Signer" : "Viewer"}</button>
                            {!r.customer_contact_id && (
                              <button onClick={() => saveToCustomerFile(r.id)} title="Add this recipient to the parent customer's contact list" style={{ fontSize: 10, fontWeight: 700, color: C.teal, background: "none", border: `1px dashed ${C.tealBorder || C.teal}`, borderRadius: 6, padding: "3px 10px", fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", whiteSpace: "nowrap" }}>Save to Customer</button>
                            )}
                            <div style={{ fontSize: 10, fontWeight: 700, color: C.teal, background: C.dark, borderRadius: 6, padding: "3px 10px", fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{custRole}</div>
                            <button onClick={() => { setEditingRecipient(r.id); setContactDraft({ name, email, phone, role: custRole !== "Contact" ? custRole : "Project Manager" }); }} style={{ background: "none", border: `1px solid ${C.borderStrong}`, borderRadius: 5, padding: "3px 8px", fontSize: 10, fontWeight: 700, color: C.textMuted, cursor: "pointer", fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>Edit</button>
                            <button onClick={() => deleteRecipient(r.id)} style={{ background: "none", border: `1px solid ${C.borderStrong}`, borderRadius: 5, padding: "3px 8px", fontSize: 10, fontWeight: 700, color: C.red || "#e53935", cursor: "pointer", fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }} title="Remove from this proposal (customer contact stays)">Delete</button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {showAddPicker ? (
                    <div style={{ padding: "10px 12px", background: C.linenDeep, border: `1px solid ${C.borderStrong}`, borderRadius: 8, marginTop: 4, display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase" }}>Add from customer contacts</div>
                      {(() => {
                        const available = customerContacts.filter(c => !recipients.some(r => r.customer_contact_id === c.id));
                        if (available.length === 0) return <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui, fontStyle: "italic" }}>No other contacts on file for this customer.</div>;
                        return available.map(c => (
                          <button key={c.id} onClick={() => pickExistingContact(c)} style={{ textAlign: "left", display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: C.linen, border: `1px solid ${C.border}`, borderRadius: 6, cursor: "pointer", fontFamily: F.ui }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.textHead }}>{c.name || <span style={{ color: C.textFaint, fontStyle: "italic" }}>No name</span>}</div>
                              <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 1 }}>{c.email || <span style={{ color: C.textFaint, fontStyle: "italic" }}>No email</span>}</div>
                            </div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: C.teal, background: C.dark, borderRadius: 6, padding: "3px 10px", fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{c.role || "Contact"}</div>
                          </button>
                        ));
                      })()}
                      {newContactOpen ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 10, background: C.linen, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <input value={contactDraft.name || ""} onChange={e => setContactDraft(d => ({ ...d, name: e.target.value }))} placeholder="Name" style={{ flex: 1, padding: "6px 8px", fontSize: 12, fontFamily: F.ui, border: `1px solid ${C.borderStrong}`, borderRadius: 5, background: C.linenDeep, color: C.textBody, WebkitAppearance: "none" }} />
                            <select value={contactDraft.role || "Project Manager"} onChange={e => setContactDraft(d => ({ ...d, role: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12, fontFamily: F.ui, border: `1px solid ${C.borderStrong}`, borderRadius: 5, background: C.linenDeep, color: C.textBody, WebkitAppearance: "none" }}>
                              <option>Project Manager</option>
                              <option>Office Manager</option>
                              <option>Billing Contact</option>
                            </select>
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <input value={contactDraft.email || ""} onChange={e => setContactDraft(d => ({ ...d, email: e.target.value }))} placeholder="Email" style={{ flex: 1, padding: "6px 8px", fontSize: 12, fontFamily: F.ui, border: `1px solid ${C.borderStrong}`, borderRadius: 5, background: C.linenDeep, color: C.textBody, WebkitAppearance: "none" }} />
                            <input value={contactDraft.phone || ""} onChange={e => setContactDraft(d => ({ ...d, phone: e.target.value }))} placeholder="Phone" style={{ flex: 0.7, padding: "6px 8px", fontSize: 12, fontFamily: F.ui, border: `1px solid ${C.borderStrong}`, borderRadius: 5, background: C.linenDeep, color: C.textBody, WebkitAppearance: "none" }} />
                          </div>
                          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                            <Btn sz="sm" v="ghost" onClick={() => { setNewContactOpen(false); setContactDraft({}); }}>Cancel</Btn>
                            <Btn sz="sm" onClick={createNewRecipient}>Save</Btn>
                          </div>
                        </div>
                      ) : (
                        <Btn sz="sm" v="ghost" onClick={() => { setNewContactOpen(true); setContactDraft({ name: "", email: "", phone: "", role: "Project Manager" }); }}>+ New Contact</Btn>
                      )}
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <Btn sz="sm" v="ghost" onClick={() => { setShowAddPicker(false); setNewContactOpen(false); setContactDraft({}); }}>Done</Btn>
                      </div>
                    </div>
                  ) : (
                    <Btn sz="sm" v="ghost" onClick={() => setShowAddPicker(true)} style={{ marginTop: 4 }}>+ Add Contact</Btn>
                  )}
                </>
              );
            })()}
          </div>

        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Proposal Introduction */}
          <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 800, fontSize: 12.5, color: C.textHead, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase" }}>Introduction</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {introSaved && <span style={{ fontSize: 11, color: C.green, fontWeight: 700, fontFamily: F.ui }}>Saved</span>}
                {!intro && (
                  <button onClick={() => setIntro(defaultIntro)} style={{ background: "none", border: `1px solid ${C.borderStrong}`, borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 700, color: C.textMuted, cursor: "pointer", fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                    Use Template
                  </button>
                )}
                <Btn sz="sm" v="secondary" onClick={saveIntro} disabled={introSaving}>{introSaving ? "Saving..." : "Save"}</Btn>
              </div>
            </div>
            <textarea
              value={intro}
              onChange={e => setIntro(e.target.value)}
              placeholder="Write an introduction to accompany this proposal..."
              rows={5}
              style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1.5px solid ${C.borderStrong}`, background: C.linenDeep, color: C.textBody, fontSize: 13, fontFamily: F.ui, resize: "vertical", WebkitAppearance: "none", lineHeight: 1.6 }}
            />
          </div>

          {attachments.length > 0 && (
            <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: 20 }}>
              <div style={{ fontWeight: 800, fontSize: 12.5, color: C.textHead, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>Reference Files</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {attachments.map(att => (
                  <a
                    key={att.url}
                    href={att.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ background: C.dark, color: C.teal, fontWeight: 800, fontSize: 12, fontFamily: F.display, letterSpacing: "0.06em", padding: "6px 14px", borderRadius: 6, textDecoration: "none", display: "inline-block" }}
                  >
                    {att.name}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Proposal Attachments — files sent with the proposal to customer */}
          <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 800, fontSize: 12.5, color: C.textHead, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase" }}>Proposal Attachments</div>
              <label style={{ background: C.dark, color: C.teal, fontWeight: 700, fontSize: 11, fontFamily: F.display, letterSpacing: "0.06em", padding: "5px 12px", borderRadius: 6, cursor: "pointer", textTransform: "uppercase" }}>
                {uploadingPropAttach ? "Uploading…" : "+ Add"}
                <input type="file" multiple onChange={handlePropAttachUpload} style={{ display: "none" }} disabled={uploadingPropAttach} />
              </label>
            </div>
            {proposalAttachments.length === 0 && (
              <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui }}>No attachments yet. Add files to include with this proposal.</div>
            )}
            {proposalAttachments.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {proposalAttachments.map(att => (
                  <div key={att.fullName} style={{ display: "flex", alignItems: "center", gap: 6, background: C.dark, borderRadius: 6, padding: "4px 6px 4px 14px" }}>
                    <a href={att.url} target="_blank" rel="noopener noreferrer" style={{ color: C.teal, fontWeight: 800, fontSize: 12, fontFamily: F.display, letterSpacing: "0.06em", textDecoration: "none" }}>
                      {att.name}
                    </a>
                    <button onClick={() => deletePropAttachment(att.fullName)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 14, padding: "2px 4px", lineHeight: 1 }} title="Remove">×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ background: C.dark, border: `1px solid ${C.tealBorder}`, borderRadius: 10, padding: 20 }}>
            <div style={{ fontWeight: 800, fontSize: 12.5, color: C.teal, fontFamily: F.display, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 14 }}>Summary</div>
            {[["Customer", p.customer]].map(([k, val]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.darkBorder}` }}>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", fontFamily: F.ui }}>{k}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: F.ui }}>{val}</span>
              </div>
            ))}
            {wtcs.length > 0 && (() => {
              const breakdowns = wtcs.map(w => ({ ...calcWtcBreakdown(w), name: w.work_types?.name || "Unnamed" }));
              const totals = breakdowns.reduce((a, b) => ({ price: a.price + b.price, cost: a.cost + b.cost, profit: a.profit + b.profit, discount: a.discount + b.discount }), { price: 0, cost: 0, profit: 0, discount: 0 });
              totals.margin = totals.price > 0 ? (totals.profit / totals.price) * 100 : 0;
              const hdr = { fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", fontFamily: F.ui, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "center" };
              const cell = { fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: F.ui, textAlign: "center" };
              const lbl = { fontSize: 13, color: "rgba(255,255,255,0.4)", fontFamily: F.ui };
              return (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 72px 72px 62px 72px", gap: "0 10px", padding: "8px 0", borderBottom: `1px solid ${C.darkBorder}` }}>
                    <span style={hdr} />
                    <span style={hdr}>Price</span>
                    <span style={hdr}>Cost</span>
                    <span style={hdr}>Margin</span>
                    <span style={hdr}>Profit</span>
                  </div>
                  {breakdowns.map((b, i) => (
                    <div key={`wtc-s-${i}`} style={{ display: "grid", gridTemplateColumns: "1fr 72px 72px 62px 72px", gap: "0 10px", padding: "8px 0", borderBottom: `1px solid ${C.darkBorder}` }}>
                      <span style={lbl}>WTC {i + 1} — {b.name}</span>
                      <span style={cell}>{money(b.price)}</span>
                      <span style={cell}>{money(b.cost)}</span>
                      <span style={{ ...cell, color: b.margin >= 30 ? C.green : b.margin >= 15 ? C.amber : C.red }}>{b.margin.toFixed(1)}%</span>
                      <span style={{ ...cell, color: b.profit >= 0 ? C.green : C.red }}>{money(b.profit)}</span>
                    </div>
                  ))}
                  {totals.discount > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 72px 72px 62px 72px", gap: "0 10px", padding: "8px 0", borderBottom: `1px solid ${C.darkBorder}` }}>
                      <span style={{ ...lbl, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>Subtotal</span>
                      <span style={{ ...cell, fontWeight: 800 }}>{money(totals.price + totals.discount)}</span>
                      <span style={cell} />
                      <span style={cell} />
                      <span style={cell} />
                    </div>
                  )}
                  {totals.discount > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 72px 72px 62px 72px", gap: "0 10px", padding: "8px 0", borderBottom: `1px solid ${C.darkBorder}` }}>
                      <span style={{ ...lbl, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>Discount</span>
                      <span style={{ ...cell, fontWeight: 800 }}>−{money(totals.discount)}</span>
                      <span style={cell} />
                      <span style={cell} />
                      <span style={cell} />
                    </div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 72px 72px 62px 72px", gap: "0 10px", padding: "8px 0", borderBottom: `1px solid ${C.darkBorder}` }}>
                    <span style={{ ...lbl, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>Total</span>
                    <span style={{ ...cell, fontWeight: 800 }}>{money(totals.price)}</span>
                    <span style={{ ...cell, fontWeight: 800 }}>{money(totals.cost)}</span>
                    <span style={{ ...cell, fontWeight: 800, color: totals.margin >= 30 ? C.green : totals.margin >= 15 ? C.amber : C.red }}>{totals.margin.toFixed(1)}%</span>
                    <span style={{ ...cell, fontWeight: 800, color: totals.profit >= 0 ? C.green : C.red }}>{money(totals.profit)}</span>
                  </div>
                </>
              );
            })()}
            {[["Created", fmtD(p.created_at?.slice(0,10))], ["Status", p.status]].map(([k, val]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.darkBorder}` }}>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", fontFamily: F.ui }}>{k}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: F.ui }}>{val}</span>
              </div>
            ))}
            {/* Activity Timeline */}
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${C.darkBorder}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: F.display, marginBottom: 10 }}>Activity</div>
              {[
                { label: "Created", date: p.created_at ? fmtD(p.created_at.slice(0, 10)) : null, done: true },
                p.sent_at
                  ? { label: "Sent", date: fmtD(p.sent_at.slice(0, 10)), detail: p.call_log?.customer_name || p.customer, done: true }
                  : p.approved_at
                    ? { label: "Internally Approved", date: fmtD(p.approved_at.slice(0, 10)), detail: p.approved_by, done: true }
                    : { label: "Sent / Approved", done: false },
                signatureInfo?.signed_at
                  ? { label: "Signed", date: fmtD(signatureInfo.signed_at.slice(0, 10)), detail: signatureInfo.signer_name || p.customer, done: true }
                  : p.sent_at
                    ? { label: "Awaiting Signature", detail: `${Math.max(0, Math.round((new Date() - new Date(p.sent_at)) / 86400000))}d`, done: false, warn: true }
                    : { label: "Signed", done: false },
              ].map((item, i, arr) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 14 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: item.done ? C.teal : item.warn ? C.amber : "rgba(255,255,255,0.2)", flexShrink: 0, marginTop: 2 }} />
                    {i < arr.length - 1 && <div style={{ width: 1.5, flex: 1, background: "rgba(255,255,255,0.1)", minHeight: 16 }} />}
                  </div>
                  <div style={{ paddingBottom: 8 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: item.done ? "#fff" : item.warn ? C.amber : "rgba(255,255,255,0.35)", fontFamily: F.ui }}>{item.label}</div>
                    {item.date && <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)", fontFamily: F.ui }}>{item.date}</div>}
                    {item.detail && <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.3)", fontFamily: F.ui }}>{item.detail}</div>}
                  </div>
                </div>
              ))}
            </div>
            {/* Recipients */}
            {recipients.length > 0 && (
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${C.darkBorder}` }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: F.display, marginBottom: 10 }}>Recipients</div>
                {recipients.map(r => (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `1px solid ${C.darkBorder}` }}>
                    <span style={{ fontSize: 14, flexShrink: 0 }}>📧</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", fontFamily: F.ui }}>{r.contact_name || r.contact_email}</div>
                      <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)", fontFamily: F.ui }}>
                        {r.role === "signer" ? <span style={{ color: C.teal }}>Signer</span> : <span>Viewer</span>}
                        {r.sent_at && <span> · Sent {fmtD(r.sent_at.slice(0, 10))}</span>}
                        {r.viewed_at ? <span> · Viewed {fmtD(r.viewed_at.slice(0, 10))}</span> : r.sent_at ? <span style={{ color: C.amber }}> · Not viewed</span> : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {p.status === "Sold" && (
              <div style={{ marginTop: 14 }}>
                {signedPdfUrl && !p.internal_approval ? (
                  <a href={signedPdfUrl} target="_blank" rel="noopener noreferrer" style={{ display: "block", textAlign: "center", background: C.teal, color: C.dark, borderRadius: 8, padding: "10px 0", fontSize: 12, fontWeight: 800, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", textDecoration: "none" }}>
                    ⬇ Download Signed PDF
                  </a>
                ) : p.internal_approval ? (
                  <button onClick={() => setShowPDF(true)} style={{ display: "block", width: "100%", textAlign: "center", background: C.teal, color: C.dark, borderRadius: 8, padding: "10px 0", fontSize: 12, fontWeight: 800, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", border: "none", cursor: "pointer" }}>
                    ⬇ Download Approved PDF
                  </button>
                ) : null}
              </div>
            )}
            {p.internal_approval && (
              <div style={{ marginTop: 14, background: "rgba(48,207,172,0.08)", border: `1px solid ${C.tealBorder}`, borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.teal, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Internally Approved</div>
                <div style={{ fontSize: 12, color: "#fff", fontFamily: F.ui }}>{p.approved_by}</div>
                {p.approval_reason && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontFamily: F.ui, marginTop: 2 }}>{p.approval_reason}</div>}
                {p.approved_at && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: F.ui, marginTop: 4 }}>{new Date(p.approved_at).toLocaleString()}</div>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Customer Billing Schedule (SOV / G702-G703) */}
      <div style={{ marginTop: 18 }}>
        <BillingScheduleSection proposal={p} teamMember={teamMember} />
      </div>

      {/* Internal Approve Modal */}
      {showApproveModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,20,35,0.7)", backdropFilter: "blur(4px)" }}
          onClick={e => { if (e.target === e.currentTarget) setShowApproveModal(false); }}>
          <div style={{ background: C.linenCard, borderRadius: 16, width: "min(440px,90vw)", padding: "28px 32px", boxShadow: "0 24px 80px rgba(0,0,0,0.35)" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 4 }}>Internal Approval</div>
            <div style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui, marginBottom: 20 }}>Mark this proposal as Sold without customer signature.</div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textFaint, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6, fontFamily: F.display }}>Approved By</div>
              <select value={approveBy} onChange={e => setApproveBy(e.target.value)}
                style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1.5px solid ${C.borderStrong}`, background: C.linenDeep, fontSize: 14, color: C.textBody, fontFamily: F.ui, outline: "none", WebkitAppearance: "none" }}>
                <option value="">— Select —</option>
                {allTeamMembers.map(m => (
                  <option key={m.id} value={m.name}>{m.name}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textFaint, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6, fontFamily: F.display }}>Reason</div>
              <textarea value={approveReason} onChange={e => setApproveReason(e.target.value)}
                placeholder="e.g. GC doesn't sign sub proposals, verbal approval from PM..."
                rows={3}
                style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1.5px solid ${C.borderStrong}`, background: C.linenDeep, fontSize: 14, color: C.textBody, fontFamily: F.ui, outline: "none", resize: "vertical", boxSizing: "border-box" }} />
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <Btn sz="sm" v="ghost" onClick={() => setShowApproveModal(false)}>Cancel</Btn>
              <Btn sz="sm" onClick={handleInternalApprove}>Approve as Sold</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProposalDetail;
