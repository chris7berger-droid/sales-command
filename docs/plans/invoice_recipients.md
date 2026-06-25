# Plan — Invoice Recipients (main + viewers)

**Branch:** `feat/invoice-recipients`
**Date:** 2026-06-25
**Backlog:** Refines/closes the **invoice half** of **F30** (T2 — "CC support on pay app + invoice send flows"). Pay-app half stays open.
**Author:** build session (T3), pre-audit draft

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
- **Send handler** (`handleSend` `:648-679`): invokes `send-invoice` with single `customerEmail`, then fires `qb-sync-invoice`.
- **Edge fn** (`send-invoice/index.ts`): re-resolves the billing email server-side from the DB (does NOT trust body `customerEmail` — H10/C9 trust-boundary hardening), mints a Stripe payment link (`:157-188`), sends ONE email to `customerEmail` (`:221-259`) containing a **Pay Now** button (`checkoutUrl`, `:251`) and a **View Full Invoice** link (`viewInvoiceUrl` from `invoice.viewing_token`, `:253`). Sender gets a confirmation copy (`:273-302`).
- **`invoices` table** has `viewing_token (uuid)` → public read-only page at `/invoice/{token}` (PublicInvoicePage).

**Key insight [DERIVED]:** the pay link (`checkoutUrl`, Stripe-hosted) and the view link (`viewInvoiceUrl`, our `viewing_token` page) are already separate URLs. Viewers simply get an email with the view link and **no** Pay Now button. → must VERIFY PublicInvoicePage exposes no independent pay action (see §7 audit item A4).

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

- **RLS:** follow the standard tenant pattern (4 policies: select/insert/update/delete scoped to `tenant_id = get_user_tenant_id()`), matching `proposal_recipients` / `customer_contacts`. Read `CLAUDE_RLS.md` before writing policies; index `tenant_id` and `invoice_id`.
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

### 4.3 Send view + handler (`Invoices.jsx:909-933`, `:648-679`) [LOCKED]

- Send view: replace the single "Sending to" box with a recipient summary — main (gets pay link) + viewers (view-only), reflecting `invoice_recipients`. Guard: block send if no `main` resolvable.
- `handleSend`: no longer passes a single `customerEmail`. The edge fn loads recipients from the DB (do NOT trust body — consistent with C9). Body keeps `invoiceId` + display fields only.

### 4.4 Edge fn `send-invoice/index.ts` [LOCKED]

- After resolving the invoice + customer chain, **load `invoice_recipients` for this invoice** (server-side, tenant-scoped).
- **Recipient set & fallback:** if no rows exist (legacy invoices / not yet configured), fall back to today's single-billing-contact behavior as `main` — zero-regression path.
- **Allowlist gate [LOCKED — security]:** validate every recipient email against the customer's own contacts ∪ `customers.{billing_email,contact_email,email}` (the C9 soft-allowlist model already used by `send-pay-app:182-217`). Drop/refuse off-allowlist addresses so a low-priv user can't exfiltrate invoice PDFs/links to arbitrary inboxes.
- **Main** → existing Pay Now email (mint Stripe link as today; only the main email contains `checkoutUrl`).
- **Viewers** → view-only email: same invoice summary + `viewInvoiceUrl` (viewing_token page), **no Pay Now button**. New small template or a `payable: boolean` flag on the existing template.
- Mint the Stripe payment link **once** (not per-recipient) — viewers never receive it.
- Stamp `sent_at` per `invoice_recipients` row.
- Sender confirmation email (`:273-302`): list all recipients (main + viewers) for a paper trail (satisfies F30 part 4).

---

## 5. Files to touch

| File | Change |
|---|---|
| `supabase/migrations/<new>.sql` | Create `invoice_recipients` + RLS + indexes |
| `src/pages/Invoices.jsx` | Recipients section in InvoiceDetail; rewire send view + `handleSend` |
| `supabase/functions/send-invoice/index.ts` | Load recipients, allowlist-gate, main-vs-viewer email split, per-row `sent_at`, sender summary |
| `docs/BACKLOG.md` | Update F30 (invoice half closed; pay-app half open) |
| `CLAUDE.md` | Add `invoice_recipients` to the Supabase Column Reference |

---

## 6. Out of scope / deferred [DERIVED]

- **`viewed_at` tracking.** Column added for parity, but the `viewing_token` page link is per-invoice (one token shared by all recipients), so per-recipient view tracking isn't trivially derivable. Not wired this pass.
- **Pay-app recipients** (the other half of F30) — separate task.
- Backfill of historical invoices into `invoice_recipients` — none; fallback path covers legacy invoices.

---

## 7. Risks / open questions for audit

- **A1 [DESIGN-OPEN]** Main/viewer UI affordance: user said "checkbox." Proposal uses a pill toggle. Recommend a checkbox labeled "Main recipient (gets pay link)" that radio-behaves (checking one unchecks others). Confirm.
- **A2 [DESIGN-OPEN]** Seed behavior: auto-insert a `main` row for the resolved billing contact on first load, vs. implicit main until the user edits. Recommend implicit fallback in the edge fn (no auto-write) + UI showing the resolved billing contact as the default main, so we don't mutate data just by opening the screen.
- **A3 [LOCKED, verify impl]** Exactly-one-main invariant — must hold across add, toggle, delete (deleting the main should surface "no main" and block send, not silently send to a viewer).
- **A4 [DERIVED — must verify]** Confirm PublicInvoicePage (`/invoice/{viewing_token}`) exposes **no** independent pay action; if it does, viewers could still pay via the view link and the double-payment guard is incomplete.
- **A5 [LOCKED — security]** Allowlist must gate viewers too, not just main (C9 threat model). Off-allowlist viewer = refuse or drop with a clear error, not silent send.
- **A6** `invoices.id` is text; ensure FK + all queries treat `invoice_id` as text.
- **A7** Money-bearing edge fn — re-confirm the Stripe link is minted once and only attached to the main email; a refactor slip that loops the mint or attaches `checkoutUrl` to a viewer reintroduces the double-pay bug.

---

## 8. Build / deploy discipline

- Build code + local checks (`npm run build`) on `feat/invoice-recipients` only.
- **Do NOT** push the migration or deploy the edge fn until a `/buildvsplan` pass clears the diff (build-vs-plan deploy gate). Migration push uses `npm run db:push` after `scripts/check-migration-safety.sh`.
- Smoke `send-invoice` against a TEST recipient after deploy (verify main gets pay link, viewer gets view-only, sender summary lists both) before calling it done.

---

## Audit manifest

**Scope:** this plan doc + the four cited code anchors (`ProposalDetail.jsx:931-1066`, `Invoices.jsx:613-679` & `:909-933`, `send-invoice/index.ts`). Read-only.

**Finding cap:** default per /auditcriteria.

**Questions for the audit to answer:**
1. Is mirroring `proposal_recipients` into a new `invoice_recipients` table the right call, or should invoices reuse an existing structure? (data-model fit)
2. Does the main-vs-viewer email split fully close the double-payment risk given the `viewing_token` page (A4)?
3. Is the allowlist plan (§4.4 / A5) consistent with the C9 threat model as implemented in `send-pay-app`?
4. Any money-write fail-safe gaps (CLAUDE.md Data Integrity #6/#7) introduced by the edge-fn refactor (A7)?
5. Is the zero-regression fallback (no recipient rows → single billing contact as main) correct and complete?
6. RLS correctness for `invoice_recipients` vs `CLAUDE_RLS.md` anti-pattern.
