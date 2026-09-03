// Decision Engine — maps invoice problems to QB actions with step-by-step playbooks
// Reuses daysOverdue + fmt from utils.js (no duplicate helpers)
// All lookup tables frozen at module load for fast reads

import { daysOverdue, fmt } from "./utils";

// ─── Problem Reasons (frozen) ─────────────────────────────────────────────────
export const REASONS = Object.freeze([
  { id: "wont_pay",   label: "Customer won't pay",            icon: "🚫", desc: "Sent to collections, ghosting, or refused" },
  { id: "overbilled", label: "We overbilled / billing error", icon: "📝", desc: "Wrong amount, duplicate, or scope changed" },
  { id: "retention",  label: "Retention dispute",              icon: "🔒", desc: "GC holding retention, terms unclear" },
  { id: "quality",    label: "Customer disputes work quality", icon: "🔨", desc: "Go-back, punch list, or warranty claim" },
  { id: "misapplied", label: "Payment applied wrong",         icon: "🔀", desc: "Payment exists but hit the wrong invoice" },
  { id: "partial",    label: "Partial payment / short pay",   icon: "✂️",  desc: "They paid less than invoiced, no explanation" },
  { id: "unknown",    label: "Don't know — need to research", icon: "❓", desc: "Can't tell what happened, need to dig in" },
]);

const REASON_MAP = Object.freeze(Object.fromEntries(REASONS.map((r) => [r.id, r])));
export { REASON_MAP };

// ─── Recommended Actions (frozen) ─────────────────────────────────────────────
export const ACTIONS = Object.freeze({
  write_off:        { id: "write_off",        label: "Write Off as Bad Debt",    icon: "🗑️",  color: "#dc2626", summary: "Remove from A/R — this money isn't coming." },
  credit_memo:      { id: "credit_memo",      label: "Issue Credit Memo",        icon: "📋", color: "#2563eb", summary: "Reduce or zero out the invoice — you overbilled." },
  retention_hold:   { id: "retention_hold",    label: "Flag Retention & Follow Up", icon: "🔒", color: "#7c3aed", summary: "Mark as retention, set reminder to follow up with GC." },
  goback_negotiate: { id: "goback_negotiate",  label: "Hold & Negotiate",         icon: "🤝", color: "#b45309", summary: "Don't touch QB yet — resolve the dispute first." },
  fix_payment:      { id: "fix_payment",       label: "Reassign Payment in QB",   icon: "🔀", color: "#059669", summary: "Move the payment to the correct invoice." },
  partial_followup: { id: "partial_followup",  label: "Chase the Difference",     icon: "✂️",  color: "#d97706", summary: "Contact customer about the short pay, then decide." },
  accountant_review:{ id: "accountant_review", label: "Send to Accountant",       icon: "📊", color: "#6366f1", summary: "Bundle for your accountant to review." },
});

// Pre-built reason→action map (static paths) + partial special case
const STATIC_MAP = Object.freeze({
  wont_pay: "write_off",
  overbilled: "credit_memo",
  retention: "retention_hold",
  quality: "goback_negotiate",
  misapplied: "fix_payment",
  unknown: "accountant_review",
});

export function getRecommendedAction(reasonId, inv) {
  const static_ = STATIC_MAP[reasonId];
  if (static_) return static_;
  if (reasonId === "partial") {
    const age = inv ? daysOverdue(inv.dueDate) : 0;
    const amt = inv ? Math.abs(inv.openBalance) : 0;
    return (age > 180 && amt < 500) ? "write_off" : "partial_followup";
  }
  return "accountant_review";
}

// ─── QB Playbooks ─────────────────────────────────────────────────────────────
// Only called when panel is visible (lazy). Generates personalized QB steps.
export function getPlaybook(actionId, inv, custName) {
  const num = inv?.num || "____";
  const amt = inv?.openBalance != null ? fmt(Math.abs(inv.openBalance)) : "$____";
  const name = custName || "____";
  const job = inv?.job || "";
  const today = new Date().toLocaleDateString("en-US");
  const jobSuffix = job ? " / " + job : "";

  const PLAYBOOKS = {
    write_off: {
      title: "Write Off as Bad Debt",
      taxNote: "You're on cash basis — you were never taxed on this income because you never received the money. This write-off cleans up your A/R but has zero tax impact. It's purely administrative.",
      steps: [
        `Open QuickBooks Online → click "+ New" → select "Journal Entry"`,
        `Date: ${today}`,
        `Line 1: Account = "Bad Debt Expense" → Debit = ${amt}`,
        `Line 2: Account = "Accounts Receivable" → Credit = ${amt} → Name = "${name}"`,
        `Memo: "Write-off Invoice #${num} — ${name}${jobSuffix} — uncollectable, approved ${today}"`,
        `Click "Save and close"`,
        `Go to the original invoice #${num} and link the journal entry to close it out`,
      ],
      important: "Always document WHY it's uncollectable in the memo. If you ever get audited, the memo is your paper trail.",
    },
    credit_memo: {
      title: "Issue Credit Memo",
      taxNote: "A credit memo reduces your revenue, which on cash basis means it adjusts income you haven't received. This is the correct way to handle overbilling — it keeps your books accurate.",
      steps: [
        `Open QuickBooks Online → click "+ New" → select "Credit Memo"`,
        `Customer: "${name}"`,
        `Date: ${today}`,
        `Add the same line items as Invoice #${num}, adjusted to the correct (reduced) amount — the credit should equal ${amt}`,
        `Memo: "Credit memo for Invoice #${num} — billing correction${jobSuffix}"`,
        `Click "Save and close"`,
        `QBO will ask if you want to apply this credit to an open invoice — select Invoice #${num}`,
      ],
      important: "If it's a partial overbill (not the full amount), adjust the credit memo line items to only reflect the difference.",
    },
    retention_hold: {
      title: "Flag as Retention — No QB Change Yet",
      taxNote: "Retention is money the GC is contractually holding until project completion. Don't write it off — it's not bad debt, it's a timing issue. Leave it in A/R.",
      steps: [
        `No changes in QB right now — this is a follow-up action, not a booking action`,
        `In AR Command: flag this invoice as "Retention" if not already flagged`,
        `Set an expected payment date based on when retention should release (check your subcontract)`,
        `Add a note with the GC's retention terms and your contact person`,
        `Follow up with the GC project manager or accounts payable on the release timeline`,
        `If retention has been held past the contractual release date, escalate to the GC's main office`,
      ],
      important: "If the project is complete and they're still holding retention past the contract terms, that's a collections issue — not a retention issue. Reclassify it.",
    },
    goback_negotiate: {
      title: "Hold — Resolve the Dispute First",
      taxNote: "Don't touch QB until the dispute is settled. If you write it off or credit it before resolving, you lose leverage. If you eventually agree to reduce the amount, use a credit memo at that point.",
      steps: [
        `No changes in QB right now — resolve the dispute first`,
        `In AR Command: flag this invoice as "Go Back" so it's separated from your active A/R`,
        `Document the dispute in notes: what's the complaint, when did it start, who's involved`,
        `Schedule a call or site visit with the customer to discuss`,
        `After resolution: if you agree to reduce → issue a credit memo for the difference`,
        `After resolution: if they agree to pay → remove the Go Back flag and chase payment`,
        `After resolution: if truly uncollectable → reclassify as "Won't Pay" and write off`,
      ],
      important: "Keep a paper trail of all communications about the dispute. If it escalates to legal, you'll need it.",
    },
    fix_payment: {
      title: "Reassign Misapplied Payment",
      taxNote: "This is a QB housekeeping fix — no tax impact. You're just moving money from one invoice to another within the same customer.",
      steps: [
        `Open QuickBooks Online → go to the Customer page for "${name}"`,
        `Find the payment that was applied incorrectly (look for credits or unapplied payments)`,
        `Click on the payment to open it`,
        `Under "Outstanding Transactions," uncheck the wrong invoice`,
        `Check the correct invoice (Invoice #${num}) to apply the payment there instead`,
        `Click "Save and close"`,
        `Verify: the old invoice should now show as open, and #${num} should show as paid/partially paid`,
      ],
      important: "If the payment was deposited and reconciled, be careful — changing it could affect your reconciliation. If in doubt, ask your bookkeeper to handle this one.",
    },
    partial_followup: {
      title: "Chase the Short Pay",
      taxNote: "Don't adjust anything in QB yet. Contact the customer first to understand why they short-paid. It could be a legitimate deduction (backcharge, retention) or an error on their end.",
      steps: [
        `Contact "${name}" accounts payable — ask for remittance detail on Invoice #${num}`,
        `Find out: was the short pay intentional? If so, what's the reason?`,
        `If they withheld retention → flag as Retention in AR Command`,
        `If they deducted a backcharge → get documentation, then issue a credit memo for the valid portion`,
        `If it was an error → ask them to cut a check for the difference (${amt})`,
        `If they refuse to pay the balance and it's small → consider writing off as bad debt`,
        `Add notes in AR Command documenting the outcome`,
      ],
      important: "Short pays are the #1 source of A/R clutter in construction. Get a clear answer before making any QB changes.",
    },
    accountant_review: {
      title: "Bundle for Accountant Review",
      taxNote: "When you're not sure what the right QB action is, the safest move is to flag it and bring it to your accountant. One 30-minute session can clear a dozen of these.",
      steps: [
        `In AR Command: flag this invoice as "Accountant Review"`,
        `Add a note explaining what you know and what's confusing`,
        `When you have several flagged items, export the Accountant Review report`,
        `Schedule 30 minutes with your tax accountant — bring the report`,
        `For each item, ask: "What's the right way to handle this in QB?"`,
        `After the meeting, come back and execute the recommended actions`,
      ],
      important: "Don't let 'I need to ask my accountant' become an excuse to do nothing. Batch these up and schedule the meeting.",
    },
  };

  return PLAYBOOKS[actionId] || { title: "Unknown Action", taxNote: "", steps: ["No playbook available."], important: "" };
}
