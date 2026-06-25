# Plan — Invoice Recipients (main + viewers)

**Branch:** `feat/invoice-recipients`
**Date:** 2026-06-25
**Backlog:** Refines/closes the **invoice half** of **F30** (T2 — "CC support on pay app + invoice send flows"). Pay-app half stays open.
**Author:** build session (T3), pre-audit draft · **Revised:** T1 (planning) folding T2 audit, 2026-06-25 — see **Audit Amendments (post-T2)**
**Status:** ✅ A4 ratified **Option A** (2026-06-25) — build unblocked. See §4.5 + Audit Amendments.
**T5 (code review):** 10 findings, report-only → T3. #1 (stale email vs C9 allowlist) ratified **Option B + mandatory live display** (2026-06-25) — see **Audit Amendments (post-T5)**. #2–#10 are T3 mechanical fixes.
**T5 (security review):** 1 surviving finding (High) — pay link shipped to anon despite button removal. Ratified **Level 2** (column REVOKE `FROM anon` + explicit select), verified non-breaking — see §4.5 + Audit Amendments (post-T5) #SEC1.

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

**Type:** feature

---

## §0 Baseline (observed current state)

_Feature plan — no bug to reproduce; this records the verified current behavior the feature changes. **Read-verified** (code/schema read on `feat/invoice-recipients` @ `0ab3bf2`), not run-verified._

- **Invoices send to exactly one recipient today.** `send-invoice/index.ts` destructures the body **without** `customerEmail`/`amount` (`:26`), resolves the billing email server-side (`:80-99`), and sends **one** email via `to: customerEmail` (`:229`). No loop, no recipient list.
- **No recipient picker on invoices.** The send view shows a single read-only "Sending to" box (`Invoices.jsx:909-933`); `handleSend` invokes the fn with one recipient (`:648-679`).
- **No `invoice_recipients` table exists** — net-new in this plan. (Confirmed against the CLAUDE.md Supabase Column Reference + migrations; the analogous `proposal_recipients` exists, the invoice equivalent does not.)
- **The public invoice page can be paid by anyone holding the link.** `PublicInvoicePage.jsx:132-136` and `:278-282` render a live "Pay Now" button, reached via one `viewing_token` per invoice (shared by all recipients). This is the A4 hole the audit found.

Baseline confirms the premise: the feature adds multi-recipient + a main/viewer split where only one (single, page-payable) recipient exists today.

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

### 4.2 UI — Recipients section in `InvoiceDetail` (`Invoices.jsx`) [LOCKED behavior] [AMENDED post-T5 — see Audit Amendments (post-T5)]

- Port the proposal Recipients card into the **InvoiceDetail body** (not only the send view), so recipients are managed before sending. Place it near the existing billing/contact area.
- **Live email display [LOCKED — T5 #1, Option B]:** for any recipient with a `customer_contact_id`, the Recipients list must **display the linked contact's current email** (from the joined `customer_contacts`), NOT the stored `invoice_recipients.contact_email` snapshot. The embed at `:1285` already pulls the contact — add `email` to it and prefer the live value. This keeps the screen accurate on every open after a Customers-page edit. Stored `contact_email` is a fallback only for orphan rows (`customer_contact_id = null`). Optional polish: re-fetch recipients when the invoice view regains focus to shrink the rare already-open-during-edit window (no real-time broadcast exists — the UpdateBanner only watches app deploys, not data).
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

**Live email resolution at send [LOCKED — T5 #1, Option B] [AMENDED post-T5]:** before the allowlist gate, for any recipient with a `customer_contact_id`, **resolve its email from the live `customer_contacts` row**, not the stored `contact_email` snapshot. Send to and allowlist-check that live value. Because a linked recipient's email IS a current customer contact, it passes the allowlist by construction — fixing the stale-snapshot send-block **without weakening C9** (consistent with the documented soft-allowlist model). Orphan rows (`customer_contact_id = null`) use the stored `contact_email` and must still pass the gate; if they don't (e.g. the contact was deleted), refuse with a clear "recipient's contact no longer exists — re-add them" error (ties to T5 #2), never a raw 400.

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

### 4.5 PublicInvoicePage — remove the Pay Now button + STOP shipping the pay link to anon [LOCKED — A4 Option A ratified 2026-06-25; AMENDED post-T5 security: Level 2]

**Why:** the public invoice page is reached via one `viewing_token` shared by main + all viewers, and the page can't distinguish them. As long as the page renders its own Pay button, a viewer can pay — defeating the §1 promise. Option A closes this by making the page **view/print only**; the payer pays via the **Pay Now button in their email** (unchanged).

- Remove the Pay Now button + its checkout handler from `PublicInvoicePage.jsx:132-136` and `:278-282` (verify exact anchors at build time). Keep the invoice summary, View/Print, and any "questions?" footer.
- **Deliberate behavior change (applies to ALL invoices, not just multi-recipient):** today both the email and the page carry a Pay button; after this, only the **email** does. The payer can still always pay — their email button is the canonical path (and `send-invoice` already emails it). Note this in the build handoff and smoke-test it (single-recipient invoice still payable via email).

**[T5 SECURITY — Level 2, LOCKED 2026-06-25] Removing the button is not enough — the pay link must stop reaching anon at all.** `PublicInvoicePage.jsx:33` fetches `select("*")`, which still ships `stripe_checkout_url` (a live, payable Stripe Payment Link) to every viewer's browser (Network tab / React state), reachable via the shared `viewing_token`. Two-part fix:
- **(a) Explicit client select [required]:** replace `PublicInvoicePage.jsx:33` `select("*", proposals(...))` with an **explicit column list** that omits `stripe_checkout_url`, `stripe_payment_link_id`, `stripe_checkout_id`, `qb_invoice_id`, `qb_payment_id`. Verified: the page references **no** stripe/qb column after the fetch, so nothing on the page breaks. (Also required because after (b), an anon `select("*")` would error on the revoked columns.)
- **(b) Column-level REVOKE [the real boundary]:** migration — `REVOKE SELECT (stripe_checkout_url, stripe_payment_link_id, stripe_checkout_id, qb_invoice_id, qb_payment_id) ON public.invoices FROM anon;`. This makes the columns physically unreadable by `anon` regardless of how a request is crafted (closes the hand-crafted-anon-request hole that (a) alone leaves open).
  - **GOTCHA 1:** `FROM anon` ONLY — never `FROM public` (that would strip `authenticated` and break the internal app, which legitimately reads these columns: `Invoices.jsx:1238,1681,1762,1776-1778,2320`, void/QB/resend flows).
  - **GOTCHA 2:** do not follow with a blanket `GRANT SELECT ON invoices TO anon` — that re-exposes the columns. Keep the migration self-contained.
- **Verified non-breaking (anon surface fully traced 2026-06-25):** the only anon readers are `PublicInvoicePage` (this page) and `PublicSigningPage` (never queries invoices). `InvoicePaidPage` does no DB query. Edge fns use `service_role` (unaffected). Composes with the existing `invoices_public_view_token` ROW policy (privilege layer ≠ RLS-policy layer) — does not reawaken the `20260502130000` anti-pattern.
- This part DOES add a migration + an edge to the anon boundary — it is no longer "purely client-side."

---

## 5. Files to touch

| File | Change |
|---|---|
| `supabase/migrations/<new>.sql` | Create `invoice_recipients` + RLS + indexes |
| `src/pages/Invoices.jsx` | Recipients section in InvoiceDetail; rewire send view + `handleSend` |
| `supabase/functions/send-invoice/index.ts` | Load recipients, allowlist-gate, main-vs-viewer email split, per-row `sent_at`, sender summary |
| `src/pages/PublicInvoicePage.jsx` | **A4 Option A:** remove Pay Now button + checkout handler (`:132-136`, `:278-282`); **T5 Level 2 (a):** replace `:33` `select("*")` with explicit columns omitting `stripe_*`/`qb_*` |
| `supabase/migrations/<new2>.sql` | **T5 Level 2 (b):** `REVOKE SELECT (stripe_checkout_url, stripe_payment_link_id, stripe_checkout_id, qb_invoice_id, qb_payment_id) ON public.invoices FROM anon;` (FROM anon only — see §4.5 gotchas) |
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

- **⚠️ DEPLOY ORDER IS REVERSED THIS ROUND — UI FIRST, THEN MIGRATIONS (T4 round-2, 2026-06-25).** The `#SEC1` REVOKE migration (`20260625130000`) makes anon `select("*")` on `invoices` **error**. Prod's live `PublicInvoicePage` still does `select("*")` until the new explicit-select UI ships — so pushing the migration first **500s every customer's invoice link**. `npm run db:push` sends *both* pending migrations together, which is exactly the trap. Correct order:
  1. **Merge UI → `main` first** (Vercel deploys the explicit-select page). Public page now reads zero revoked columns — safe whether or not the revoke has landed.
  2. **`scripts/check-migration-safety.sh` → `npm run db:push`** (pushes both migrations: `invoice_recipients` create + the `130000` REVOKE). Public page already safe; table now exists.
  3. **Deploy `send-invoice --no-verify-jwt`** last (bundles the recipient-allowlist logic). *(Edge fn must come AFTER the migration — branch-i handles 0 rows, not a missing table; deploying it before `invoice_recipients` exists would error the query.)*
  - Harmless window between step 1 and 2 (≤1 tenant, you control timing): recipients UI inert (adds no-op, send uses legacy branch-i), public page fine. **Do NOT `db:push` before the UI merge.**

- Smoke `send-invoice` against a TEST recipient after deploy (verify main gets pay link, viewer gets view-only, sender summary lists both) before calling it done.
- **Smoke #SEC1:** after the revoke lands, confirm anon `select("*")` on `invoices` now **errors**, and the public page still loads via its explicit select.
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

## Audit Amendments (post-T5)

_T5 code review (`/code-review high`) found 10 issues (7 correctness, 3 cleanup), report-only → T3 fixes. Nine are mechanical fixes T3 owns. **One (#1) was routed to T1 because it touches the C9 anti-injection control** and was decided with Chris on 2026-06-25._

### T5 #1 — stale recipient email vs. the C9 allowlist → **RATIFIED Option B + mandatory live display**

**Problem:** `invoice_recipients.contact_email` is a snapshot taken at add-time. The send-time allowlist (C9) only admits emails that currently exist in the customer's contacts. If a contact is **edited or deleted on the Customers page** after being added as a recipient, the snapshot goes stale, fails the allowlist, and **hard-blocks the send with a 400** — a legitimately-added recipient gets locked out. The display also shows the stale email, which erodes user trust.

**Options weighed:** A = propagate contact edits onto recipient rows (rejected: rewrites "who we sent to" on already-sent invoices, and doesn't handle the delete/orphan case); B = resolve the live contact email at send + display for linked rows (recommended); C = both.

**Decision — Option B, with live display made mandatory (not optional):**
- **Send (§4.4):** for recipients with a `customer_contact_id`, resolve email from the **live** `customer_contacts` row for both the allowlist check and the actual send. Linked email is a current contact → passes the allowlist by construction → **C9 not weakened**. Orphan rows use the stored snapshot and must still pass; off-allowlist → clear "contact no longer exists, re-add" error (ties to T5 #2), not a raw 400.
- **Display (§4.2):** the Recipients list shows the **live** linked-contact email (add `email` to the `:1285` embed; prefer it over the stored snapshot), so the screen is accurate on every open. Stored `contact_email` is fallback for orphans only.
- **Why not A:** the existing UpdateBanner is deploy-detection only (polls the JS bundle hash every 5 min — `UpdateBanner.jsx`), NOT a data-change broadcast, so it would never refresh a stale contact email anyway. B's on-open live read is the right lever; A's edit-propagation would corrupt the historical send record. Optional cheap polish: re-fetch recipients on invoice-view focus to shrink the rare already-open-during-edit window.

### T5 Security #SEC1 — pay link still shipped to anon (High) → **RATIFIED Level 2** (column REVOKE + explicit select)

**Found by `/security-review` (confidence 9/10); the one finding that survived verification — RLS, C9 allowlist, Stripe mint-once, viewer-template separation all cleared.** §4.5 removed the public-page Pay *button*, but `PublicInvoicePage.jsx:33` still does `select("*")`, shipping `stripe_checkout_url` (a live payable Stripe link) to every viewer's browser via the shared `viewing_token`. A viewer reads it from devtools/Network and pays → the exact double-pay the feature exists to prevent.

**Decision — Level 2 (real boundary, not just hide):** (a) explicit client select omitting `stripe_*`/`qb_*` on `:33`; (b) migration `REVOKE SELECT (...) ON public.invoices FROM anon`. Level 1 (client select only) was rejected — it leaves a hand-crafted anon-request hole (anon key is in the bundle; RLS is row-level, not column-level). Full spec + gotchas in §4.5.

**Verified non-breaking before locking (anon surface fully traced):** only anon readers are PublicInvoicePage + PublicSigningPage (latter never reads invoices); InvoicePaidPage does no query; all internal `stripe_*`/`qb_*` reads are `authenticated` (untouched by `FROM anon`); composes with the existing `invoices_public_view_token` row policy.

### T5 #2–#10 — T3's to fix (no T1 decision needed)
Mechanical correctness (#2 surface "main missing email" in UI vs edge-fn 400; #3 billing-contact double-add dedup; #4 `ensureMainSeeded` early-return stranding first viewer; #5 Send modal omits `customers.email`; #6 require valid email on "+ New Contact"; #7 `toggleMain` non-atomic) + cleanup (#8–10). T3 revises against cited source per item. #2 pairs with the orphan-error path above.

---

## Audit manifest

_Regenerated by `/auditcriteria` (feature mode) on 2026-06-25. Consumed by `/runaudit` to size the round-2 sign-off._

### Bottom line (plain English)
Final sign-off round on a small, money-touching feature whose one risky decision (viewers paying) is now resolved. Point a small, focused check at two things: (1) did the six fixes from last round actually land in the plan, and (2) does removing the public-page Pay button truly close the double-pay hole. Not a fresh deep dive — a confirmation pass.

### Round
- Plan type: **feature**
- Current round: **2**
- Plan revision under audit: `0ab3bf2`
- Findings trend: round 1 (6: 0C/0H/4M/2L) → round 2 (?) — verification round; expect regressions + any new material only

### Prior rounds
- Round 1: `fcb4c3d` (revision response) · 0C/0H/4M/2L · pattern: `locked-promise-unachievable`

**Briefing for agents:** do NOT re-find round-1 issues. They were folded in at `fcb4c3d` + `0ab3bf2` (see Audit Amendments block). First run the REGRESSION CHECK — verify each round-1 fix actually took in the revised plan — then attack ONLY material new to this revision.

### Deployment context
- **Live tenants:** 1 — HDSP only; multi-tenant onboarding blocked. Cross-tenant findings cap at Med.
- **Prod / staging / dev:** affected surface (`send-invoice`, invoice send UI, public invoice page) is **live in prod for the paying tenant**.
- **Blocking feature flags:** none.
- **Concurrency profile:** solo / ≤5. Multi-user race findings cap at Low.

### Time budget + finding cap
- **Time budget:** ~60 min (focused verification round)
- **Finding cap:** 6 findings. Remainder → "Quarantined (not actionable this loop)."

### Surface
- Total lines: ~200
- Sections: §0–§8 + Audit Amendments + manifest
- [LOCKED] decisions: ~10 (incl. A4 Option A, §4.4 edge-fn spec, §4.5 page change, RLS)
- [DESIGN-OPEN] items: 2 (A1 checkbox affordance, A2 seed behavior, §4.2 styling)
- [BLOCKED] items: 0 (A4 ratified)
- Plan-to-code ratio: plan ~200 lines vs est. ~250–350 code lines — healthy, not scope-crept.

### Layers touched
- Migrations / schema (`invoice_recipients`)
- RLS / multi-tenancy
- State model (role main/viewer, one-main invariant)
- UI / components (InvoiceDetail recipients, send view, PublicInvoicePage)
- Edge functions / API (`send-invoice` refactor)
- External integrations (Stripe payment link, Resend email)

### New mechanisms introduced
- New table: `invoice_recipients`
- New column vocabulary: `role ('main'|'viewer')`
- New edge-fn logic: 3-branch recipient resolution, per-recipient allowlist, main-first/viewers-non-fatal send loop, separate viewer email template
- Removed affordance: PublicInvoicePage Pay Now button

### Cross-system reach
- Stripe (payment link mint — must stay once-per-send), Resend (two templates), shared Supabase project (migration ledger collision check via `npm run db:push`)
- Service-role write path: `send-invoice` runs as service_role (RLS bypassed) → explicit tenant scoping required (folded in, #6)

### Irreversibility
- One additive migration (new table) — reversible; no destructive change, no backfill.
- PublicInvoicePage Pay-button removal — reversible (client code).

### Known weak points
- A4/§4.5: the fix is a **client-side button removal** — verify no *other* entry point on the public page (or a deep link) still initiates checkout (regression risk if a handler is left wired).
- §4.4 multi-send: partial-failure path is new; verify `sent_at` per-row stamping can't blanket-stamp on a partial failure.
- §4.4 allowlist is intentionally soft (UI-added emails auto-pass) — confirm that's acceptable at 1 tenant and clearly documented, not a silent hole.

### Open questions
- Count: 2–3 (A1 checkbox vs pill, A2 seed-on-load vs implicit, §4.2 styling) — all [DESIGN-OPEN], low-stakes, not gating.
- Highest-pressure: none gating; A4 is resolved.

### Suggested attack angles (2 total)
1. **Money/security + regression** — covers edge fn, Stripe, public page, multi-tenancy. Required reading: `send-invoice/index.ts`, `PublicInvoicePage.jsx`, `send-pay-app/index.ts` (allowlist pattern). Pressure: confirm round-1 fixes #1/#3/#4/#5/#6 landed correctly in §4.4/§4.5; verify Pay button truly gone (no stray checkout path); Stripe minted once; viewer template has no `checkoutUrl`.
2. **Schema / RLS / state model** — covers migration, RLS, one-main invariant. Required reading: `sql/rls_child_tables.sql:205-238`, CLAUDE_RLS.md, §4.1/§4.3. Pressure: FK text-type, 4-policy pattern, one-main invariant across add/toggle/delete, no-main → 400 guard.

### Suggested agent count: 2

Rationale: round-2 verification of a well-specified plan — two deep verifiers over the two risk clusters (money/security and schema/state) beat a fresh fan-out; the gating decision is already resolved so no third "design" angle is needed.
