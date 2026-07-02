# Plan — Invoice Email Attachments (persisted, historical)

_Authored 2026-07-02. Planning terminal (T1). Grounded in a full read of
`send-invoice/index.ts`, `send-pay-app/index.ts`, `Invoices.jsx` send view +
`handleSend` + `InvoiceDetail`, `PayAppDetailModal.jsx` upload handlers,
`_shared/recipientAllowlist.ts`, and the `invoice_recipients` migration._

**Status: Round-2 audit folded in (2026-07-02) — BUILD-READY (T3).** Plateau
broken by bounding attachments at upload (Round-2 Option 1). See
`## Audit Amendments (post-Round-2)`. Send back only if the edge-fn bounds or the
modal-state wiring need a Round-3 check.

Confidence tags per section: **[LOCKED]** = user-ratified intent · **[DERIVED]**
= inferred from code, verify in audit · **[DESIGN-OPEN]** = needs a decision.

---

## §0 Baseline (observed current state)

- **Regular invoice send has NO attachment capability.** `send-invoice/index.ts`
  builds an HTML-only Resend email (`sendEmail`, `:354-362`) — payload is
  `{ from, to, subject, html }`, no `attachments` field. Customer gets a Stripe
  pay link + a "View Full Invoice / Print PDF" hyperlink (`:315`); the invoice
  PDF is never attached.
- **The pattern we need already exists one folder over.** `send-pay-app/index.ts`
  base64-encodes PDFs from storage (`arrayBufferToBase64`, `:56`) and passes a
  Resend `attachments: [...]` array (`:357-374`), gated by an SSRF storage
  allowlist (`isAllowedStorageUrl`, `:18-29`). It already attaches a **release
  waiver** (`release_waiver_url`). This task lifts that mechanism into the regular
  invoice send and generalizes it to N persisted attachments.
- **Upload UI pattern exists.** `PayAppDetailModal.handleUploadWaiver` (`:196-218`)
  uploads to `job-attachments` (sanitized filename), `getPublicUrl`, persists the
  URL to a column. We copy this shape.
- **Extract precedent exists.** `_shared/recipientAllowlist.ts` was extracted
  (T5 #9) so both send fns share one implementation. The attachment helpers get
  the same treatment (Round-1 Finding D).
- **`InvoiceDetail` already owns child-collection state and passes it as a prop.**
  `recipients` is loaded in `InvoiceDetail` and passed to `InvoicePDFModal`
  (`Invoices.jsx:2397`); the modal's `loadContact` only self-fetches when the prop
  is absent (`:662`). Attachments mirror this (Round-1 Findings B/C).
- **Send handler already re-derives sensitive data server-side.** `handleSend`
  (`:688-749`) sends only display fields; `send-invoice` loads recipients/amount
  from the DB (audit C9 / B36). Attachments follow the same rule.

---

## 1. Problem / intent [LOCKED]

Chris needs to attach a **release waiver** (and, generally, one or more arbitrary
documents) to a regular invoice email, **persisted** so that opening an invoice
historically shows exactly what documents went out with it. One invoice may carry
**multiple** attachments at once — a collection (table), not a single column.

Scenario: a partial invoice sent with a waiver, then the remaining-billing invoice
sent later with its own waiver. Each is a **separate `invoices` row**, so each
carries its own attachment set — no cross-invoice coupling.

---

## 2. The model to mirror (`send-pay-app`) [DERIVED]

| Concern | `send-pay-app` does | This plan does |
|---|---|---|
| Attachment source | fixed columns on rows | rows in new `invoice_attachments` table |
| SSRF defense | `isAllowedStorageUrl` (`:18-29`) | shared helper, `job-attachments` bucket, **path-pinned to `invoice-attachments/${invoiceId}/`** |
| Encode | `arrayBufferToBase64` (`:56`) | same helper (extracted to `_shared`) |
| Resend field | `attachments: [...]` (`:357-374`) | same, built ONCE from N rows |
| Client trust | URLs re-derived from DB, body ignored | same — client passes nothing |
| Failure mode | invoice PDF required; extras 400 on bad URL | **fail-open**: every attachment non-fatal → `warnings[]` (Option 1, ratified) |

---

## 3. Invoice side today [DERIVED]

- `handleSend` (`:688-749`) → `functions.invoke("send-invoice", { body })` with
  display fields only.
- Send view UI: `:979-1034` (`view === "send"`) — Main / Viewers / Amount panels,
  then "Send Invoice with Pay Link" (`:1028`, disabled on
  `sending || noMainBlock || mainMissingEmail`).
- `send-invoice`: creates the Stripe link (`:215-268`), persists it (`:274-278`),
  then sends MAIN (fatal) + each VIEWER (non-fatal → `warnings[]`) via
  `sendEmail(to, html)` (`:354-362`).

---

## 4. Proposed change

### Ratified design call — Round 1: fail-open, pre-Stripe attachment handling [LOCKED]

Attachments are handled **fail-open** and **before** the Stripe payment link is
created. No attachment problem (bad URL, unfetchable file, oversize) may block the
invoice+pay-link email or leak past into a Stripe side effect — a failed waiver
becomes a `warnings[]` entry, never a hard error. Ratified 2026-07-02 (Round-1
Findings A + D).

### Ratified design call — Round 2: bound attachments AT UPLOAD [LOCKED]

**Max 3 attachments per invoice, each ≤ 10 MB, rejected client-side before
`storage.upload` (§4.2).** This breaks the two-round `copied-mechanism-misfit`
plateau: bounding at the source removes the reason the copied send-fn loop needed
progressive hardening. The edge-fn size handling (§4.4) becomes a cheap **secondary**
guard on already-bounded input, not the primary defense. Ratified 2026-07-02
(Round-2 plateau analysis). With this taken, Round 2 is the last round.

### 4.1 DB — new `invoice_attachments` table [LOCKED shape, DERIVED columns]

Authored in **`command-suite-db`** (SC no longer owns migrations — CLAUDE.md).
This section is the **spec**; the file is created + pushed there at build. Modeled
on `20260625120000_invoice_recipients.sql`.

```sql
-- Invoice Attachments — documents emailed with an invoice, persisted so an
-- invoice's history shows exactly what went out with it. One invoice may have
-- many. RLS: standard 4-policy tenant pattern. No anon policy — the public
-- invoice page does not list attachments (§6).
CREATE TABLE IF NOT EXISTS public.invoice_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id text NOT NULL
    REFERENCES public.invoices(id) ON DELETE CASCADE,
  file_url text NOT NULL,          -- public URL in job-attachments bucket
  storage_path text NOT NULL,      -- object path for precise delete (Finding F)
  file_name text NOT NULL,         -- original (sanitized) filename
  label text,                      -- e.g. 'Release Waiver' (freeform; defaults to file_name)
  content_type text,               -- from the upload (best-effort)
  size_bytes bigint,               -- DISPLAY ONLY — the send cap uses FETCHED bytes (Finding G/I, §4.4)
  created_by uuid,                 -- forced to auth.uid() by BEFORE INSERT trigger below (R2 Finding D)
  created_at timestamptz NOT NULL DEFAULT now(),
  tenant_id uuid NOT NULL DEFAULT get_user_tenant_id()
    REFERENCES public.tenant_config(id)
);
-- created_by: a column DEFAULT is client-overridable; force it authoritatively.
CREATE OR REPLACE FUNCTION public.set_invoice_attachment_created_by()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN NEW.created_by := auth.uid(); RETURN NEW; END $$;
CREATE TRIGGER trg_invoice_attachments_created_by
  BEFORE INSERT ON public.invoice_attachments
  FOR EACH ROW EXECUTE FUNCTION public.set_invoice_attachment_created_by();
-- NOTE (R2 Finding G/I): the earlier UNIQUE(invoice_id, file_url) was DROPPED —
-- file_url carries crypto.randomUUID() entropy, so it can never collide; the
-- constraint was inert. No natural dup key exists for a random-path upload.
CREATE INDEX IF NOT EXISTS idx_invoice_attachments_invoice_id
  ON public.invoice_attachments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_attachments_tenant_id
  ON public.invoice_attachments(tenant_id);
ALTER TABLE public.invoice_attachments ENABLE ROW LEVEL SECURITY;
-- 4 policies (select/insert/update/delete) TO authenticated,
-- USING/WITH CHECK (tenant_id = get_user_tenant_id()) — copy verbatim from
-- invoice_recipients migration.
```

**Storage:** reuse the **`job-attachments`** public bucket (already has a DELETE
policy, migration `20260420120000`). Path carries **random entropy** so a public
URL is not enumerable (Round-1 Finding E):

```
invoice-attachments/{invoice_id}/{crypto.randomUUID()}-{cleanName}
```

`cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")` (CLAUDE.md storage rule).
The `{invoiceId}/` segment is REQUIRED and is enforced again in the edge-fn
allowlist prefix (§4.4). **Ratified: public bucket + unguessable random path**
(matches the existing waiver model, no signing needed on fetch/download).
_[Documented stronger alternative, not chosen for v1: private bucket + signed URLs
— would add signing to both the edge-fn fetch and the historical download.]_

### 4.2 UI — Attachments panel in the send view (`Invoices.jsx`) [LOCKED behavior]

Add an **Attachments** panel inside `view === "send"` (after Amount `:1021-1024`,
before the send button `:1028`). Mirrors `PayAppDetailModal` UX.

- **Upload bounds — client-side, BEFORE `storage.upload` (R2 Option 1) [LOCKED]:**
  reject the pick if it would exceed **3 attachments** on this invoice, or if the
  file is **> 10 MB**. Surface a plain inline message ("Up to 3 files, 10 MB each")
  and never call `storage.upload`/`insert` for a rejected file. These are the
  authoritative bounds; §4.4's byte cap is a secondary guard.
- **Add:** hidden `<input type="file" accept="application/pdf,.docx,.xlsx,.xls,image/*">`
  behind a styled label (copy `PayAppDetailModal:574-612`). On pick (after the
  bounds check): set `uploading` → sanitize name → build path with
  `crypto.randomUUID()` → `storage.from("job-attachments").upload(path, file, { contentType })`
  → `getPublicUrl` → `insert` into `invoice_attachments`
  `{ invoice_id, file_url, storage_path: path, file_name, label, content_type, size_bytes }`
  (`tenant_id`/`created_at` default; `created_by` forced by trigger §4.1) →
  `reloadAttachments()` → clear `uploading`.
- **Modal state wiring (R2 Finding C) [LOCKED]:** `InvoicePDFModal` holds its own
  `const [attachments, setAttachments] = useState([])` **seeded from the prop**,
  plus a `reloadAttachments()` that re-selects for `invoice.id`, plus an
  `onAttachmentsChanged` callback it fires after add/remove so `InvoiceDetail`
  re-fetches its copy. Mirror `reloadRecipients` (`Invoices.jsx:1126`) and the way
  recipient mutations call it (`:1180`, `:1209`, `:1225`).
- **Send-button gate (R1 Finding B):** add `uploading` to the disable at `:1028` —
  `disabled={sending || noMainBlock || mainMissingEmail || uploading}`.
- **Label:** defaults to the filename; quick-pick chips (**Release Waiver**,
  **Lien Release**) set the label in one tap; freeform edit allowed.
  _[DESIGN-OPEN: preset list — §7 #A.]_
- **Remove — order-of-ops + failure surface (R2 Findings D + F) [LOCKED]:**
  **row-first, then storage.** Delete the `invoice_attachments` row (by `id`), and
  only on success call `storage.remove([storage_path])` (path taken from the
  **`storage_path`** column, never re-parsed from `file_url`).
  - Row delete fails → **abort with an inline error; the file is untouched**
    (consistent, retry-able). Nothing is orphaned.
  - Row delete succeeds, `storage.remove` fails/no-ops → the row (and its download
    link) is already gone from the UI, so the user sees a correct list; log +
    non-blocking warning; the leaked object is reclaimed by the storage-orphan
    sweep tracked in **S10** (bucket-wide DELETE hardening). Rationale: a dangling
    *row* (broken link the user sees) is worse than an orphaned *file* (invisible,
    bounded by the 3-file cap + random path).
  - ⚠️ `storage.remove` silently returns `[]` without a DELETE policy —
    `job-attachments` HAS one; don't trust the empty array (memory:
    storage-remove-silent-noop). This is exactly why the row is the source of truth
    and goes first.
- Panel lists current attachments (label · filename · remove ✕).

### 4.3 Send handler (`handleSend`, `:688-749`) [LOCKED]

**No change to the request body.** Attachments are NOT passed to the edge fn —
`send-invoice` re-derives them from `invoice_attachments` by `invoice_id`
(server-trust rule, audit C9). The client cannot inject an outbound attachment URL.

### 4.4 Edge fn `send-invoice/index.ts` [LOCKED]

**Ordering (R1 Finding A):** all attachment work happens **immediately after the
invoice tenant gate (`:53-55`) and BEFORE Stripe link creation (`:237`)**. If a
future edit throws in this block it must be caught locally; nothing here may abort
the send or run after the Stripe link is minted.

**Declaration hoist — BUILD-BREAKING if missed (R2 regression) [LOCKED]:** the
attachment block runs before `:237`, but `const warnings: string[] = []` is
currently declared at **`:364`** and there is no `attachmentsPayload` yet. **Hoist
both `warnings` and `attachmentsPayload` to just after the tenant gate (`~:55`),
above the attachment block, and DELETE the existing `:364` `warnings`
re-declaration** — leaving both would shadow/`const`-redeclare and fail the build.
The viewer loop and sender-notification block already reference `warnings`; they
now read the hoisted one.

1. **Shared helpers (Finding D — extract NOW):** create
   `supabase/functions/_shared/attachments.ts` exporting `isAllowedStorageUrl`
   and `arrayBufferToBase64` (lifted from `send-pay-app`; precedent
   `_shared/recipientAllowlist.ts`). `send-invoice` imports both.
   - `ALLOWED_STORAGE_BUCKETS = ["job-attachments"]` **only** (drop
     `signed-proposals` — invoice attachments never live there; Round-1 Finding D).
   - Tighten the allowlist to require the path prefix
     `/storage/v1/object/public/job-attachments/invoice-attachments/${invoiceId}/`
     — so even a valid-bucket URL from another invoice/tenant is rejected.
   - _(send-pay-app keeps its own copy this loop — not touched, §6. Migrating it
     onto the shared helper is a filed follow-up.)_
2. **Load rows (tenant-scoped, once, capped, non-throwing) (R2 Regression + A):**
   after the hoist, `select("file_url, file_name, label")` from
   `invoice_attachments`
   `.eq("invoice_id", invoiceId).eq("tenant_id", invoice.tenant_id).limit(3)`
   (service role bypasses RLS → explicit tenant filter mandatory, matches
   recipients `:109-113`; `.limit(3)` mirrors the upload bound). **A load error
   must NOT throw** — `if (loadErr) { warnings.push("Attachments couldn't be
   loaded"); attachmentRows = []; }` and proceed to the pay-link send.
3. **Validate + fetch + encode ONCE, each row isolated, size-guarded BEFORE fetch
   (R2 Regression + A + B):**
   ```
   let totalBytes = 0; const CAP = 35 * 1024 * 1024; const PER = 10 * 1024 * 1024;
   for (const row of (attachmentRows || [])) {          // null-safe (R2 regression)
     try {
       if (!isAllowedStorageUrl(row.file_url, invoiceId)) { warnings.push(...); continue; }
       if (totalBytes >= CAP) { warnings.push(`${row.file_name} — skipped, size cap`); continue; }  // guard BEFORE fetch
       const res = await fetch(row.file_url);
       if (!res.ok) { warnings.push(...); continue; }
       const len = Number(res.headers.get("content-length") || 0);   // pre-check BEFORE arrayBuffer
       if (len > PER || totalBytes + len > CAP) { warnings.push(`${row.file_name} — skipped, too large`); continue; }
       const buf = await res.arrayBuffer();
       if (totalBytes + buf.byteLength > CAP) { warnings.push(`${row.file_name} — skipped, size cap`); continue; }  // final guard (len can lie/absent)
       totalBytes += buf.byteLength;
       attachmentsPayload.push({ filename: row.file_name, content: arrayBufferToBase64(buf) });
     } catch (e) { warnings.push(`${row.file_name} — ${e.message}`); continue; }
   }
   ```
   - **`for (const row of (attachmentRows || []))`** — never iterate `null`.
   - **Per-row `try/catch` → `warnings.push` + `continue`.** No attachment error —
     including the load error above — ever throws out of this block or reaches
     `sendEmail`.
   - **Size guarded BEFORE buffering:** skip on the running total *before* fetch,
     and on `content-length` *before* `arrayBuffer()`, so an oversize file is never
     read into memory (defense against a bounded-at-upload cap being bypassed).
     Bounds are authoritative at upload (§4.2); this is the secondary guard.
   - `attachmentsPayload` (hoisted) is built **exactly once** and reused for MAIN +
     every viewer — no per-recipient re-fetch.
4. **Attach to sends:** extend `sendEmail(to, html)` → `sendEmail(to, html, attachments)`
   and pass `attachmentsPayload` to the MAIN send (`:368`) and each VIEWER send
   (`:394`). **Viewers get the documents too** (ratified — a "copy for your
   records" should include the waiver).
5. **Sender notification (`:407-442`):** append the attachment names, escaped via
   the existing `esc` (`:301`).

### 4.5 Historical view (`InvoiceDetail` + detail modal) [LOCKED]

Load attachments **in `InvoiceDetail`'s own effect keyed on `inv.id`**, into its
own `attachments` state, and pass them to `InvoicePDFModal` as a **prop** — mirror
`recipients` at `Invoices.jsx:2397` (Round-1 Findings B/C). **Do NOT** hang the
fetch off the modal's `loadContact` effect, which is keyed on `proposal_id` and
would miss/re-fetch incorrectly.

**Render site (R2 Finding C):** add the read-only attachment list to the
`InvoiceDetail` detail view **directly below the Recipients section render at
`Invoices.jsx:2152`** (`{/* Recipients … */}`), so the two invoice child
collections sit together. Opening any invoice then shows the documents that went
with it, each a download link.

**Safe href (R2 Finding E) [LOCKED]:** before rendering `<a href={file_url}>`,
validate `file_url.startsWith(`${SUPABASE_URL}/storage/v1/object/public/job-attachments/`)`;
if it doesn't, render plain text (no anchor). Blocks a `javascript:`/`data:` scheme
from a tampered row reaching an anchor href. Also add `rel="noopener noreferrer"`.

Attachments are **invoice-scoped, not send-event-scoped** (§7 #D).

---

## 5. Files to touch

**`command-suite-db`** (migration authored + pushed here, at build):
- `supabase/migrations/<ts>_invoice_attachments.sql` — table (incl. `storage_path`,
  `created_by` set by a BEFORE INSERT trigger; no UNIQUE — inert on random paths)
  + 2 indexes + 4 RLS policies + the `created_by` trigger/function.

**`sales-command`**:
- `supabase/functions/_shared/attachments.ts` — **NEW.** `isAllowedStorageUrl`
  (bucket + `invoice-attachments/${invoiceId}/` prefix) + `arrayBufferToBase64`.
- `supabase/functions/send-invoice/index.ts` — import shared helpers; load
  `invoice_attachments`; validate/fetch/encode once, fail-open, pre-Stripe, size
  cap; attach to main + viewers; list in sender notification (§4.4).
- `src/pages/Invoices.jsx` — send-view Attachments panel + upload/remove handlers +
  `uploading` gate (§4.2); `InvoiceDetail` load-effect + `attachments` prop +
  historical list in detail view (§4.5).
- `docs/BACKLOG.md` — F39 row (filed) + adjacent K–N rows (see Amendments).

**Not touched (kept scoped):** `send-pay-app`, `PayAppDetailModal`,
`PublicInvoicePage`, QB sync, Stripe path.

---

## 6. Out of scope / deferred [DERIVED]

- **Public invoice page** does not list attachments (no anon RLS policy).
- **Send-event granularity** (which attachment went in send #1 vs a re-send) — v1
  treats attachments as the invoice's current document set (§7 #D).
- **Migrate `send-pay-app` onto `_shared/attachments.ts`** — filed follow-up; not
  touched this loop to stay scoped.
- **F12 "PandaDoc PDF attachment"** (BACKLOG) is an unrelated integration.

---

## 7. Risks / open questions (remaining after Round 2)

- **#A [DESIGN-OPEN] Preset label chips** — exact list (Release Waiver, Lien
  Release, …). Cosmetic; not a blocker; decide at build.
- **#D Re-send fidelity** — attachments are invoice-scoped, so adding a doc after a
  first send makes history reflect the *current* set, not literally what email #1
  carried. **Accepted for v1** (no compliance need surfaced across two rounds).
- **#XSS** — `label`/`file_name` are user input; escape at every HTML sink (sender
  notification via `esc`; React auto-escapes the detail list). Build-time check.

_Resolved from Round 1:_ ~~fail-open vs hard-fail~~ (Option 1) · ~~viewers get
docs~~ (yes) · ~~size limit~~ (bounded at upload + 35 MB fetch cap) · ~~copy vs
extract~~ (`_shared/attachments.ts`) · ~~"guessable-by-token" bucket~~
(random-entropy path).

_Resolved from Round 2:_ ~~unbounded attachment count/size~~ (max 3 × ≤10 MB at
upload) · ~~load-error/null could throw~~ (non-throwing, null-safe, `.limit(3)`) ·
~~`warnings`/`attachmentsPayload` build break~~ (hoisted, `:364` re-decl removed) ·
~~buffer-then-skip~~ (size guard before fetch + content-length pre-check) ·
~~client-settable `created_by`~~ (trigger) · ~~inert UNIQUE~~ (dropped) ·
~~unspecified remove order~~ (row-first + failure surface, §4.2) · ~~unsafe
`<a href>`~~ (public-prefix validation, §4.5) · ~~modal-state wiring~~
(`reloadAttachments` + `onAttachmentsChanged`, §4.2).

---

## 8. Build / deploy discipline

- **Migration:** author on its own branch in `command-suite-db`; `npm run db:push`
  there (safety + collision guards). **Sequence after any in-flight Schedule
  Command migration** — don't push while sch-command's `db:push` is mid-flight;
  second one rebases on `main` first (single shared ledger).
- **Edge fn:** `supabase functions deploy send-invoice --no-verify-jwt` (memory).
  CORS unchanged (`_shared/cors.ts`). New `_shared/attachments.ts` ships with it.
- **Post-deploy smoke (memory):** TEST-named job → attach a waiver → send to a TEST
  recipient → confirm (a) email arrives with the attachment, (b)
  `invoice_attachments` row exists, (c) historical list renders it, (d) remove
  actually deletes the file, (e) an oversize/garbage-URL row is skipped with a
  warning and the pay-link email still sends.
- **Gates:** `/buildvsplan` → `/code-review` → `/security-review` (storage
  allowlist, tenant scoping, email egress, RLS all touched — required).

---

## Audit Amendments (post-Round-1)

Round-1 audit (3 agents) on `feat/invoice-email-attachments @ c0764d2`: 6 caused-by
findings (2H / 4M), 4 adjacent. Pattern: **copied-mechanism-misfit** (the
`send-pay-app` mechanism was lifted without adapting to invoice-flow ordering,
trust, and lifecycle differences). Outcome: accepted-pending-changes.

**Design call ratified:** **Option 1 — fail-open, pre-Stripe attachment handling.**

### Findings folded into the plan
- **A (High) — attachment failure could abort the send / run post-Stripe.** →
  §4.4 moved all attachment work before Stripe link creation; per-row try/catch →
  `warnings` + continue; payload built once; no throw reaches `sendEmail`.
- **B (High) — invoice sendable mid-upload.** → §4.2 adds `uploading` to the
  send-button disable at `:1028`.
- **C (Med) — attachment fetch hung off the wrong effect / re-fetched per
  recipient.** → §4.5 loads in `InvoiceDetail` keyed on `inv.id` + prop (mirror
  recipients `:2397`); §4.4 fetches/encodes once.
- **D (Med) — helper duplicated + bucket too broad.** → §4.4 extracts
  `_shared/attachments.ts`; `ALLOWED_STORAGE_BUCKETS = ["job-attachments"]` with
  path pinned to `invoice-attachments/${invoiceId}/`.
- **E (Med) — public bucket URL enumerable.** → §4.1 random-entropy path
  (`crypto.randomUUID()`); §7 #7 text corrected.
- **F (Med) — remove re-parsed the URL / didn't verify.** → §4.1 adds
  `storage_path`; §4.2 removes via it, deletes storage then row, verifies both.
- **G/I (Low, cheap — folded) —** §4.1: `created_by DEFAULT auth.uid()`,
  `UNIQUE(invoice_id, file_url)`, size for the cap from fetched bytes not the
  client column.

### Adjacent (filed to BACKLOG, NOT fixed this loop) — Findings K–N
> Round-1 named K–N as adjacent but shipped no descriptions, so nothing was
> fabricated. Round 2 supplied text for the storage-security adjacents
> (**bucket-wide DELETE** on `job-attachments`; **sharper `storage_path` deletion
> vector**) — now filed as **S10** (there was no pre-existing "row L"; the only
> `L`-row is the unrelated `L15`). Any remaining K/M/N still lack text.

---

## Audit Amendments (post-Round-2)

Round-2 audit (3 agents) on `feat/invoice-email-attachments @ fe388e6`: 1 Med
**regression** + 6 caused-by (0H/3M/3L) + 1 adjacent. Trend vs R1: severity DOWN
(2H→0H), count FLAT (6→6) → **plateau**; theme unchanged (`copied-mechanism-misfit`).
Scope analysis: the copied send-fn mechanism is load-bearing; the fix is to remove
the reason it needed hardening.

**Design call ratified: Round-2 Option 1 — bound attachments AT UPLOAD** (max 3 ×
≤10 MB, client-side). This breaks the plateau; Round 2 is the last round.

### Findings folded into the plan
- **Regression (Med) — `warnings`/`attachmentsPayload` used before declaration once
  the block moved pre-Stripe → build break.** → §4.4 hoist both above `~:55`,
  delete the `:364` re-declaration; null-safe loop.
- **A (Med) — load could throw / unbounded rows.** → §4.4 non-throwing load,
  `.limit(3)`.
- **B (Med) — buffer-then-skip read oversize files into memory.** → §4.4 guard the
  running total before fetch + `content-length` pre-check before `arrayBuffer()`.
- **C (Med) — modal-owned state / render site unnamed.** → §4.2 modal `useState`
  seeded from prop + `reloadAttachments()` + `onAttachmentsChanged` (mirror
  `reloadRecipients :1126`); §4.5 render at `:2152` (mirror recipients).
- **D (Low) — `created_by` DEFAULT client-overridable; UNIQUE inert.** → §4.1
  BEFORE INSERT trigger forces `auth.uid()`; UNIQUE dropped.
- **E (Low) — `<a href>` scheme not validated.** → §4.5 public-prefix check +
  `rel="noopener noreferrer"`.
- **F (Low) — remove order-of-ops unspecified.** → §4.2 row-first + explicit
  failure surface.

### Adjacent (filed to BACKLOG as **S10**, NOT fixed this loop)
Bucket-wide DELETE policy on `job-attachments` (any authenticated user can delete
any tenant's object) + the `storage_path` deletion vector it enables (a
client-set `storage_path` pointing at another tenant's object). Pre-existing infra;
tenant/path-scoped storage policies are a separate hardening task.

---

## Audit manifest

_Seed manifest for `/runaudit`. Regenerate via `/auditcriteria` before a round._

### Bottom line (plain English)
Two rounds folded; plateau broken by bounding attachments at upload (3 × ≤10 MB).
**Build-ready.** Only re-audit (Round 3) is needed if the edge-fn bounds
(hoist/regression, size-guard-before-fetch, `.limit(3)`, non-throwing load) or the
modal-state wiring (`reloadAttachments`/`onAttachmentsChanged`) want a
verification pass — otherwise integrate at T3.

### Round
Post-Round 2 → build-ready. R1 = 6 caused-by (2H/4M); R2 = 1 regression + 6
caused-by (0H/3M/3L), plateau; theme `copied-mechanism-misfit` both rounds, broken
by Round-2 Option 1 (bound at upload).

### Deployment context
Prod money path (customer invoices). Shared Supabase ledger with a concurrent
Schedule build — migration sequenced (§8).

### Surface
`invoice_attachments` migration spec (§4.1); `_shared/attachments.ts` +
`send-invoice/index.ts` (§4.4); `Invoices.jsx` send-view + `InvoiceDetail` (§4.2,
§4.5).

### Layers touched
DB (new table + RLS), storage (job-attachments, entropy path), edge fn (email
egress + external fetch + size cap), React UI.

### New mechanisms introduced
First N-row attachment collection for invoices; first time `send-invoice` fetches
external URLs + emits Resend attachments; first `_shared/attachments.ts`.

### Cross-system reach
Resend (email), Supabase Storage (fetch + delete), shared migration ledger.

### Irreversibility
Sends real customer email; migration on shared prod ledger; deletes storage files.

### Known weak points
Edge-fn ordering/isolation correctness (did every path stay fail-open + pre-Stripe);
allowlist prefix pinning (cross-invoice/cross-tenant URL rejection); storage-delete
verify; XSS at label/filename sinks; re-send fidelity (§7 #D).

### Suggested attack angles
1. Tenant isolation + SSRF: can a crafted `file_url` or cross-tenant/cross-invoice
   `invoice_attachments` row pass the pinned prefix and reach the fetch/attach path?
2. Fail-open integrity: can any attachment error (throw, oversize, 404, non-PDF)
   abort the pay-link email, run after the Stripe link, or leak a partial send?

### Suggested agent count: 3
DB/RLS · edge-fn security (SSRF/tenant/egress/ordering) · UI+correctness.
