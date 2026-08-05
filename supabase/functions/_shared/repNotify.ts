// Shared rep-notification helpers.
//
// Both approval paths — a customer e-signature (proposal-signed) and the
// in-app Internal Approve button (proposal-approved) — must tell the job's
// sales rep the same thing, in the same words. Before this module, only the
// e-signature path had ANY email, and it trusted the browser to hand it the
// rep's address. Both are fixed here:
//
//   1. The rep address is resolved from the DB by proposal id. Never from the
//      caller. The public signing page is anonymous — nothing it sends about
//      who to notify can be trusted, and if its lookup quietly returned "" the
//      old code just skipped the email and reported success.
//   2. Sending is FAIL-SOFT. A Resend hiccup must never abort the caller: on
//      the signing path the proposal is already committed as Sold by the time
//      we get here, so throwing would roll the browser into its fallback path
//      and leave the customer staring at "already signed".

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_ADDRESS = "Sales Command <estimates@hdspnv.com>";
const SITE_URL = "https://salescommand.app";

export type RepContact = { name: string; email: string };

/**
 * Resolve the sales rep to notify for a proposal, tenant-scoped.
 *
 * `call_log.sales_name` is free text and team_members.name has at least one
 * row with a trailing space in prod ("John Paul "), so the join is on trimmed,
 * case-insensitive names rather than `=`. Returns null when the job has no rep,
 * the rep isn't an active team member, or they have no email on file.
 */
export async function resolveRepForProposal(
  sb: any,
  proposalId: string,
): Promise<
  | { ok: true; rep: RepContact; proposal: any }
  | { ok: false; reason: string; proposal: any | null }
> {
  const { data: proposal } = await sb
    .from("proposals")
    .select(
      "id, tenant_id, proposal_number, total, status, call_log_id, " +
        "call_log(job_name, display_job_number, customer_name, sales_name)",
    )
    .eq("id", proposalId)
    .maybeSingle();

  if (!proposal) return { ok: false, reason: "proposal_not_found", proposal: null };

  const salesName = (proposal.call_log?.sales_name || "").trim();
  if (!salesName) return { ok: false, reason: "job_has_no_sales_rep", proposal };

  const { data: members } = await sb
    .from("team_members")
    .select("name, email, active")
    .eq("tenant_id", proposal.tenant_id)
    .eq("active", true);

  const match = (members || []).find(
    (m: any) => (m.name || "").trim().toLowerCase() === salesName.toLowerCase(),
  );

  if (!match) return { ok: false, reason: `no_active_team_member:${salesName}`, proposal };
  if (!match.email) return { ok: false, reason: `rep_has_no_email:${salesName}`, proposal };

  return { ok: true, rep: { name: (match.name || "").trim(), email: match.email }, proposal };
}

function money(n: unknown): string {
  const v = Number(n);
  if (!isFinite(v)) return "";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function shell(inner: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1c1814;">
      <div style="border-bottom: 4px solid #30cfac; padding-bottom: 16px; margin-bottom: 24px;">
        <h2 style="margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: 0.02em;">High Desert Surface Prep</h2>
        <p style="margin: 4px 0 0; color: #4a4238; font-size: 13px;">Industrial &amp; Commercial Concrete Coatings</p>
      </div>
      ${inner}
      <p style="color: #887c6e; font-size: 12px; margin-top: 24px;">— Sales Command</p>
    </div>
  `;
}

/**
 * Send one email. Never throws — returns whether it went out so the caller can
 * report `emailed: false` instead of failing the whole operation.
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  tag: string,
): Promise<{ sent: boolean; detail: string }> {
  if (!RESEND_API_KEY) {
    console.error(`${tag}: RESEND_API_KEY is not set — cannot notify ${to}`);
    return { sent: false, detail: "resend_key_missing" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html }),
    });
    const body = await res.text();
    if (!res.ok) {
      // Loud on purpose: a silent mail failure is exactly how the rep-notify
      // gap went unnoticed for months.
      console.error(`${tag}: Resend rejected send to ${to} — ${res.status} ${body}`);
      return { sent: false, detail: `resend_${res.status}` };
    }
    console.log(`${tag}: emailed ${to} — ${body}`);
    return { sent: true, detail: "ok" };
  } catch (e) {
    console.error(`${tag}: Resend call threw for ${to} — ${(e as Error).message}`);
    return { sent: false, detail: "resend_threw" };
  }
}

/**
 * Notify the job's sales rep that a proposal was approved.
 *
 * `how` distinguishes the two approval routes so the rep can tell a customer
 * signature apart from someone approving it internally on their behalf.
 */
export async function notifyProposalApproved(
  sb: any,
  proposalId: string,
  how: { kind: "signed"; signerName: string } | { kind: "internal"; approvedBy: string; reason: string },
): Promise<{ emailed: boolean; detail: string; to?: string }> {
  const tag = "notifyProposalApproved";
  const resolved = await resolveRepForProposal(sb, proposalId);

  if (!resolved.ok) {
    console.error(`${tag}: no rep to notify for proposal ${proposalId} — ${resolved.reason}`);
    return { emailed: false, detail: resolved.reason };
  }

  const { rep, proposal } = resolved;
  const cl = proposal.call_log || {};
  const jobLabel = cl.job_name || cl.display_job_number || "this job";
  const customer = cl.customer_name || "the customer";
  const amount = money(proposal.total);
  const jobLine = amount ? `${jobLabel} — <strong>${amount}</strong>` : jobLabel;

  const lede = how.kind === "signed"
    ? `<p>Good news — <strong>${customer}</strong> signed Proposal #${proposal.proposal_number} for <strong>${jobLabel}</strong>.</p>
       <p>Signed by: <strong>${how.signerName || "—"}</strong></p>`
    : `<p>Proposal #${proposal.proposal_number} for <strong>${jobLabel}</strong> (${customer}) was approved internally.</p>
       <p>Approved by: <strong>${how.approvedBy || "—"}</strong><br/>
       Reason: ${how.reason || "—"}</p>`;

  const html = shell(`
    <p>Hi ${rep.name},</p>
    ${lede}
    <p>${jobLine}</p>
    <p>Status is now <strong>${proposal.status}</strong>.
       <a href="${SITE_URL}/proposals/${proposal.id}" style="color: #0f766e;">Open it in Sales Command</a>.</p>
  `);

  const subject = how.kind === "signed"
    ? `Proposal Signed — ${jobLabel}`
    : `Proposal Approved — ${jobLabel}`;

  const result = await sendEmail(rep.email, subject, html, tag);
  return { emailed: result.sent, detail: result.detail, to: rep.email };
}

export { shell as emailShell, money as formatMoney, SITE_URL };
