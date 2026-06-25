# Plan — Invoice Recipients (main + viewers)

**Branch:** `feat/invoice-recipients`
**Date:** 2026-06-25
**Backlog:** Refines/closes the **invoice half** of **F30** (T2 — "CC support on pay app + invoice send flows"). Pay-app half stays open.
**Author:** build session (T3), pre-audit draft · **Revised:** T1 (planning) folding T2 audit, 2026-06-25 — see **Audit Amendments (post-T2)**
**Status:** ✅ A4 ratified **Option A** (2026-06-25) — build unblocked. See §4.5 + Audit Amendments.

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

---

## 1. Problem / intent [LOCKED]

The invoice send flow emails exactly one recipient — the resolved billing contact (`Invoices.jsx:617-633` frontend, `send-invoice/index.ts:80-106` server). Proposals already let the user attach multiple recipients with roles (`signer` / `viewer`) via the **Recipients** section on `ProposalDetail.jsx:931-1066`, backed by the `proposal_recipients` table.

**User ask (verbatim intent):** "I need the ability to add another viewer to the invoice like I have here on the proposal." One person must be the **main** recipient (the one who gets the actionable pay link); the rest are **viewers**. Designate the main via a checkbox.

**Why main-vs-viewer matters (user rationale) [LOCKED]:** the invoice email carries a Stripe pay link. If two people receive a live pay link, both could attempt payment → double payment. So the pay link goes to **one** recipient only; viewers get a **view-only** email.

This supersedes F30's lighter "CC textarea → Resend `cc:`" spec: a plain CC would put the pay link in every inbox — the exact failure mode we're avoiding.

---

## 2. How proposals do it today (the model to mirror) [DERIVED]

**Table** `proposal_recipients` (CLAUDE.md verified):
`id, proposal_id, contact_name, contact_email, phone, role ('signer'|'viewer'), sent_at, viewed_at, created_at, customer_contact_id (FK customer_contacts ON DELETE SET NULL)`. Only one `signer` per proposal, enforced in UI not DB.

**UI** `ProposalDetail.jsx:931-1066` — Recipients card:
- Primary customer contact row (read/edit email) — `:940-964`
- Additional recipient rows: name/email/phone, role pill from `customer_contacts.role`, **Signer/Viewer toggle** (`toggleSigner` `:472-482`), Edit, Delete, and "Save to Customer" on orphan rows — `:967-1016`
- "+ Add Contact" → picker of existing `customer_contacts` not already added (`pickExistingContact` `:385-396`) + "+ New Contact" inline form (`createNewRecipient` `:398-438`) — `:1018-1062`
- Delete removes the recipient row only, not the customer contact (`deleteRecipient` `:440-444`)

**Send** (`ProposalPDFModal.jsx` `handleSend` `:51-135`): loops recipients, calls `send-proposal` per recipient with `isViewer` flag, inserts `proposal_recipients` rows with `sent_at`.

---

## 3. Invoice side today [DERIVED]

- **Frontend resolve** (`Invoices.jsx:613-633`): finds `customer_contacts` with `is_billing_contact` / `role='Billing Contact'` (primary first, else newest), falls back to `customers.{billing_email,contact_email}`. Stored in `billingEmail`/`billingName` state.
- **Send view** (`Invoices.jsx:909-933`): shows a single read-only "Sending to" box. No picker.
- **Send handler** (`handleSend` `:648-679`): currently passes `customerEmail`/`amount` in the body, but **the edge fn ignores both** — its destructure at `send-invoice:26` omits `customerEmail`/`amount` and it re-resolves them server-side (`:80-99`). So the frontend value is already dead weight; this plan stops sending it. Then fires `qb-sync-invoice`.
- **Edge fn** (`send-invoice/index.ts`): re-resolves the billing email server-side from the DB (does NOT trust body `customerEmail`/`amount` — H10/C9 trust-boundary hardening, destructure at `:26`, resolve at `:80-99`), mints a Stripe payment link (`:157-188`), sends ONE email to `customerEmail` (`:221-259`) containing a **Pay Now** button (`checkoutUrl`, `:251`) and a **View Full Invoice** link (`viewInvoiceUrl` from `invoice.viewing_token`, `:253`). Sender gets a confirmation copy (`:273-302`).
- **`invoices` table** has `viewing_token (uuid)` → public read-only page at `/invoice/{token}` (PublicInvoicePage).

**Key insight — CORRECTED post-T2 [LOCKED — audit-disproved]:** the original draft assumed the view link was safe because the pay link (`checkoutUrl`) is a separate Stripe URL. **The audit disproved this.** `PublicInvoicePage.jsx:132-136` and `:278-282` render a live **Pay Now** button to anyone holding the invoice's `viewing_token`, and there is **one** `viewing_token` per invoice shared by main + all viewers. A viewer who opens the "View Full Invoice" link **can pay** — the page cannot tell main from viewer. This breaks the §1 LOCKED promise ("viewers can't pay") as drawn. Resolution is the gating A/B decision — see **A4** in §7 and the **Audit Amendments (post-T2)** block.

---

## 4. Proposed change

### 4.1 DB — new `invoice_recipients` table [LOCKED shape, DERIVED columns]

Mirror `proposal_recipients`, swapping `proposal_id`→`invoice_id` and the role vocabulary:

```
invoice_recipients:
  id (uuid, pk, default gen_random_uuid())
  invoice_id (text, FK invoices(id) ON DELETE CASCADE, NOT NULL)
  contact_name (text)
  contact_email (text)
  phone (text)
  role (text NOT NULL DEFAULT 'viewer' CHECK role IN ('main','viewer'))
  sent_at (timestamptz)
  viewed_at (timestamptz)            -- column for parity; tracking NOT wired this pass (see §6)
  customer_contact_id (uuid, FK customer_contacts(id) ON DELETE SET NULL)
  created_at (timestamptz DEFAULT now())
  tenant_id (uuid NOT NULL DEFAULT get_user_tenant_id(), FK tenant_config)
```

- **RLS [LOCKED — audit-confirmed]:** the standard 4-policy tenant pattern (select/insert/update/delete scoped to `tenant_id = get_user_tenant_id()`) with `tenant_id` DEFAULT `get_user_tenant_id()` matches `sql/rls_child_tables.sql:205-238` exactly. **No anon policy is needed** — the public page (PublicInvoicePage) never queries `invoice_recipients`. Read `CLAUDE_RLS.md` before writing; index `tenant_id` and `invoice_id`.
- **One `main` per invoice:** enforce in UI (mirror `toggleSigner`). NOT a DB constraint (proposals don't have one either).
- `invoice_id` is **text** (invoices.id is text), unlike proposal_recipients' text proposal_id — confirm FK type matches.
- Migration filename: next free timestamp via `npm run db:push` collision check. Do NOT push yet (see §8).

### 4.2 UI — Recipients section in `InvoiceDetail` (`Invoices.jsx`) [LOCKED behavior]

- Port the proposal Recipients card into the **InvoiceDetail body** (not only the send view), so recipients are managed before sending. Place it near the existing billing/contact area.
- **Styling [DESIGN-OPEN]:** the proposal card uses linen tokens (`C.linenCard`, etc.); the invoice detail/send view currently uses white/`#F9FAFB` "paper" styling (`:917-925`). Per CLAUDE.md "no white backgrounds in internal app," the Recipients card should use linen tokens like the proposal version. Confirm placement doesn't sit inside the print/paper region.
- Rows: name/email/phone, role pill, **Main/Viewer toggle** (checkbox or pill toggle — mirror `toggleSigner` semantics: setting one main unsets the others), Edit, Delete, "Save to Customer" for orphan rows.
- "+ Add Contact": reuse the exact picker pattern (`customer_contacts` not-yet-added + inline new-contact form).
- **Default seed:** when the section first loads with no rows, seed the resolved billing contact as the **main** (don't force the user to re-pick what the old single-recipient flow already knew). Open question whether to auto-insert a row or treat the resolved billing contact as an implicit main until edited — see §7 A2.
- Handlers mirror `ProposalDetail`: `reloadRecipients`, `pickExistingContact`, `createNewRecipient`, `saveRecipient`, `deleteRecipient`, `saveToCustomerFile`, `toggleMain` (= `toggleSigner` renamed).

### 4.3 Send view + handler (`Invoices.jsx:909-933`, `:648-679`) [LOCKED] [AMENDED post-T2 — see Audit Amendments]

- Send view: replace the single "Sending to" box with a recipient summary — main (gets pay link) + viewers (view-only), reflecting `invoice_recipients`.
- **Block send when there are recipient rows but none is `main`** (mirror the edge-fn 400 guard in §4.4 branch iii). The UI must surface "No main recipient — pick who gets the pay link" and disable Send, rather than letting the request reach the edge fn. This mirrors the existing disabled-send behavior when `billingEmail` is empty (`:919`, `:927`).
- `handleSend`: no longer passes `customerEmail`/`amount` (the edge fn already ignores both — see §3). The edge fn loads recipients from the DB (do NOT trust body — consistent with C9). Body keeps `invoiceId` + display fields only.

### 4.4 Edge fn `send-invoice/index.ts` [LOCKED] [AMENDED post-T2 — see Audit Amendments]

**Load (tenant-scoped, belt-and-suspenders) [#6]:** after resolving the invoice + customer chain, load `invoice_recipients`:
```
.from("invoice_recipients").select(...)
  .eq("invoice_id", invoiceId)
  .eq("tenant_id", invoice.tenant_id)   // fn runs as service_role → RLS bypassed; scope explicitly (send-pay-app S5 pattern)
```

**Recipient resolution — THREE explicit branches [#2/A3]** (do not collapse into one; never promote a viewer to main):
- **(i) 0 rows** → fall back to today's single resolved billing-contact as the `main` (zero-regression for legacy / not-yet-configured invoices).
- **(ii) exactly one `main`** (+ any viewers) → proceed.
- **(iii) rows exist but NO `main`** → return **400 and BLOCK send** — mirror the existing "No customer email on file" guard at `send-invoice:101-106`. Do **not** silently elevate a viewer. (UI also blocks this per §4.3, but the fn is the authoritative gate.)

**Per-recipient allowlist gate — soft C9 model [#3/A5] [LOCKED — security]:** run the gate **per recipient**, including orphan rows with `customer_contact_id = null`, against the customer's contacts ∪ `customers.{billing_email,contact_email,email}` (the `send-pay-app:186-209` pattern). Off-allowlist email → refuse that recipient with a clear error.
- *Accepted limitation (1 tenant):* this is intentionally **soft** — `createNewRecipient` (§4.2) writes the typed email into `customer_contacts` first, so any contact added through the UI auto-passes the gate. It blocks raw body-injected addresses, not UI-added ones. Kept as-is per the C9 model; revisit if multi-tenant ships.

**Stripe link — mint exactly once, BEFORE any recipient loop [#4/A7]:** keep the mint at `send-invoice:157-188`. `checkoutUrl` is referenced **only** in the main branch. Do not move the mint inside a loop; do not pass `checkoutUrl` to any viewer path.

**Two separate email templates [#4/A7]** (NOT a `payable` boolean on one shared template):
- **Main** → existing Pay Now email (`checkoutUrl` + `viewInvoiceUrl`).
- **Viewer** → a **separate template that has no `checkoutUrl` parameter at all** (compile-time impossible to leak the pay link): invoice summary + `viewInvoiceUrl` only. *(Independent of A4 — A4 governs whether the view *page* exposes its own Pay button; this governs the email.)*

**Multi-send failure semantics [#5]** (new — plan was silent):
- Send the **main first**. A main-send failure **aborts** the whole operation and returns an error (the invoice isn't "sent" if the payer never got it).
- After main succeeds, send each viewer. A viewer-send failure is **non-fatal** — collect into a `warnings: []` array in the response (mirror the non-fatal sender-notification at `send-invoice:299-301`).
- Stamp `invoice_recipients.sent_at` **per row, only on that row's own success** — never blanket-stamp.

**Sender confirmation email (`:273-302`):** list all recipients (main + viewers) for a paper trail (satisfies F30 part 4); include any viewer-send warnings.

### 4.5 PublicInvoicePage — remove the Pay Now button [LOCKED — A4 Option A ratified 2026-06-25]

**Why:** the public invoice page is reached via one `viewing_token` shared by main + all viewers, and the page can't distinguish them. As long as the page renders its own Pay button, a viewer can pay — defeating the §1 promise. Option A closes this by making the page **view/print only**; the payer pays via the **Pay Now button in their email** (unchanged).

- Remove the Pay Now button + its checkout handler from `PublicInvoicePage.jsx:132-136` and `:278-282` (verify exact anchors at build time). Keep the invoice summary, View/Print, and any "questions?" footer.
- **Deliberate behavior change (applies to ALL invoices, not just multi-recipient):** today both the email and the page carry a Pay button; after this, only the **email** does. The payer can still always pay — their email button is the canonical path (and `send-invoice` already emails it). Note this in the build handoff and smoke-test it (single-recipient invoice still payable via email).
- No DB/RLS change here — purely removing a client-side affordance. Does not depend on `invoice_recipients`.

---

## 5. Files to touch

| File | Change |
|---|---|
| `supabase/migrations/<new>.sql` | Create `invoice_recipients` + RLS + indexes |
| `src/pages/Invoices.jsx` | Recipients section in InvoiceDetail; rewire send view + `handleSend` |
| `supabase/functions/send-invoice/index.ts` | Load recipients, allowlist-gate, main-vs-viewer email split, per-row `sent_at`, sender summary |
| `src/pages/PublicInvoicePage.jsx` | **A4 Option A:** remove Pay Now button + checkout handler (`:132-136`, `:278-282`); page becomes view/print only |
| `docs/BACKLOG.md` | Update F30 (invoice half closed; pay-app half open) |
| `CLAUDE.md` | Add `invoice_recipients` to the Supabase Column Reference |

---

## 6. Out of scope / deferred [DERIVED]

- **`viewed_at` tracking.** Column added for parity, but the `viewing_token` page link is per-invoice (one token shared by all recipients), so per-recipient view tracking isn't trivially derivable. Not wired this pass.
- **Pay-app recipients** (the other half of F30) — separate task.
- Backfill of historical invoices into `invoice_recipients` — none; fallback path covers legacy invoices.

**ADJACENT findings (T2-tagged — file as backlog, NOT this task's work):**
- **Stripe Payment Links are reusable by default** — the double-charge window relies on `stripe-webhook` deactivation on paid. Pre-existing (exists today regardless of this change); relates to F30. → file as backlog row.
- **Per-recipient `viewed_at`** not derivable from one shared `viewing_token` (already deferred above). → backlog if/when per-recipient tokens land (Option B).

---

## 7. Risks / open questions for audit

- **A1 [DESIGN-OPEN]** Main/viewer UI affordance: user said "checkbox." Proposal uses a pill toggle. Recommend a checkbox labeled "Main recipient (gets pay link)" that radio-behaves (checking one unchecks others). Confirm.
- **A2 [DESIGN-OPEN]** Seed behavior: auto-insert a `main` row for the resolved billing contact on first load, vs. implicit main until the user edits. Recommend implicit fallback in the edge fn (no auto-write) + UI showing the resolved billing contact as the default main, so we don't mutate data just by opening the screen.
- **A3 [LOCKED — specified]** Exactly-one-main invariant across add/toggle/delete. Resolved in §4.4 (three-branch resolution, branch iii returns 400) + §4.3 (UI blocks send with no main). Deleting the main → "no main" → send blocked, never silent viewer promotion.
- **A4 [LOCKED — Option A ratified 2026-06-25]** The §1 promise ("viewers can't pay") was not deliverable via the email split alone: `PublicInvoicePage.jsx:132-136` & `:278-282` render Pay Now on the shared-`viewing_token` page. **Resolved by Option A** — remove the Pay button from the public page (§4.5); payer pays via their email button. Option B (per-recipient tokens) was declined for this loop. Build unblocked.
- **A5 [LOCKED — specified, security]** Per-recipient soft-allowlist gate (incl. orphan rows) — specified in §4.4. Accepted soft limitation documented (UI-added contacts auto-pass; blocks body-injected addresses).
- **A6 [LOCKED]** `invoices.id` is text → `invoice_recipients.invoice_id` is text; all queries treat it as text. Specified in §4.1.
- **A7 [LOCKED — specified]** Stripe link minted once before any loop; `checkoutUrl` referenced only in the main branch; viewer template has no `checkoutUrl` param at all. Specified in §4.4.

---

## 8. Build / deploy discipline

- **A4 ratified Option A (2026-06-25) — build unblocked.** Pay-gating is handled by §4.5 (remove the public-page Pay button), not per-recipient tokens.
- Build code + local checks (`npm run build`) on `feat/invoice-recipients` only.
- **Do NOT** push the migration or deploy the edge fn until a `/buildvsplan` pass clears the diff (build-vs-plan deploy gate). Migration push uses `npm run db:push` after `scripts/check-migration-safety.sh`.
- Smoke `send-invoice` against a TEST recipient after deploy (verify main gets pay link, viewer gets view-only, sender summary lists both) before calling it done.
- **Smoke A4/§4.5:** confirm a single-recipient invoice is still payable via the **email** Pay button after the public-page button is removed (don't regress the existing pay path), and that the public page no longer renders Pay Now.

---

## Audit Amendments (post-T2)

_T2 audit folded in by T1 (planning) on 2026-06-25. All findings below were tagged **CAUSED-BY**. LOCKED sections were amended via pointer, not silent edit._

### ✅ Gating decision (A4) — RATIFIED Option A (2026-06-25)

T2 found the feature's one LOCKED promise — **"viewers can't pay"** — was not achievable as the plan was drawn. The view-only *email* (§4.4) was necessary but never sufficient: the public invoice *page* itself shows a Pay button to anyone with the link, and main + viewers all share **one** `viewing_token`. So a viewer clicks "View Full Invoice" and can pay.

**Chris ratified Option A:** remove the Pay Now button from `PublicInvoicePage` (now §4.5) — the page becomes view/print only and the payer pays via the Pay button in their email. Option B (per-recipient tokens) declined for this loop. Build unblocked.

### Findings folded in

| # | Audit ID | Where | What changed |
|---|---|---|---|
| 1 | A4 | §3, §7 A4, §8 | The "separate pay vs view URL" assumption was **disproved** — `PublicInvoicePage.jsx:132-136`/`:278-282` render Pay Now on the shared `viewing_token` page. A4 → **[BLOCKED — awaiting A/B]**; build gated. |
| 2 | A3 | §4.4, §4.3 | Fallback split into **three** explicit edge-fn branches: 0 rows → billing-contact main; one main → send; rows-but-no-main → **400 + block** (mirror `:101-106`). Never promote a viewer. UI blocks too. |
| 3 | A5 | §4.4 | Allowlist clarified as the **soft C9 model**, run **per-recipient incl. orphans** (`send-pay-app:186-209`). Documented accepted limitation: `createNewRecipient` writes to `customer_contacts` so UI-added emails auto-pass. |
| 4 | A7 | §4.4 | Viewer email is a **separate template with no `checkoutUrl` param** (not a `payable` flag). Stripe link minted **once before any loop**; `checkoutUrl` only in main branch. |
| 5 | — (new) | §4.4 | **Multi-send failure semantics** added: main sent first (failure aborts); viewer failures non-fatal → `warnings[]`; `sent_at` stamped per-row on that row's own success only. |
| 6 | — | §4.4 | Recipient load uses `.eq("invoice_id",…)` **and** `.eq("tenant_id", invoice.tenant_id)` — fn runs service_role (RLS bypassed). |

### Doc nits corrected
- §3 prose: clarified `send-invoice` already ignores body `customerEmail`/`amount` (destructure omits them at `:26`; resolves server-side `:80-99`).
- §4.1 RLS marked **[LOCKED — audit-confirmed]**: 4-policy tenant pattern + `tenant_id DEFAULT get_user_tenant_id()` matches `sql/rls_child_tables.sql:205-238`; no anon policy needed (public page never queries this table).

### Adjacent (filed to backlog, not this task) — see §6
- Stripe Payment Links reusable-by-default / double-charge window (pre-existing, relates to F30).
- Per-recipient `viewed_at` not derivable from one shared token.

---

## Audit manifest

**Scope:** this plan doc + the four cited code anchors (`ProposalDetail.jsx:931-1066`, `Invoices.jsx:613-679` & `:909-933`, `send-invoice/index.ts`). Read-only.

**Note (post-T2):** manifest below is the pre-build round. **Hold any `/auditcriteria` regen until the A4 A/B decision is ratified** — Option B forks the scope (per-recipient tokens become a second pass), which materially changes what a re-audit would size. Regenerating now would size an audit for a plan whose shape is still pending Chris's call.

**Finding cap:** default per /auditcriteria.

**Questions for the audit to answer:**
1. Is mirroring `proposal_recipients` into a new `invoice_recipients` table the right call, or should invoices reuse an existing structure? (data-model fit)
2. Does the main-vs-viewer email split fully close the double-payment risk given the `viewing_token` page (A4)?
3. Is the allowlist plan (§4.4 / A5) consistent with the C9 threat model as implemented in `send-pay-app`?
4. Any money-write fail-safe gaps (CLAUDE.md Data Integrity #6/#7) introduced by the edge-fn refactor (A7)?
5. Is the zero-regression fallback (no recipient rows → single billing contact as main) correct and complete?
6. RLS correctness for `invoice_recipients` vs `CLAUDE_RLS.md` anti-pattern.
