# Plan — Invoice Email Attachments (persisted, historical)

_Authored 2026-07-02. Planning terminal (T1). Grounded in a full read of
`send-invoice/index.ts`, `send-pay-app/index.ts`, `Invoices.jsx` send view +
`handleSend`, `PayAppDetailModal.jsx` upload handlers, and the
`invoice_recipients` migration (the direct precedent for this table)._

Confidence tags per section: **[LOCKED]** = user-ratified intent · **[DERIVED]**
= inferred from code, verify in audit · **[DESIGN-OPEN]** = needs a decision ·
**[BLOCKED]** = waiting on external.

---

## §0 Baseline (observed current state)

- **Regular invoice send has NO attachment capability.** `send-invoice/index.ts`
  builds an HTML-only Resend email (`sendEmail`, `:354-362`) — the Resend payload
  is `{ from, to, subject, html }`. No `attachments` field anywhere. The customer
  gets a Stripe pay link + a "View Full Invoice / Print PDF" hyperlink
  (`viewLinkHtml`, `:315`); the invoice PDF is never attached.
- **The pattern we need already exists one folder over.** `send-pay-app/index.ts`
  base64-encodes PDFs from storage (`arrayBufferToBase64`, `:56`) and passes a
  Resend `attachments: [...]` array (`:357-374`), gated by an SSRF storage
  allowlist (`isAllowedStorageUrl`, `:18-29`, buckets `job-attachments` +
  `signed-proposals`). It already attaches a **release waiver**
  (`release_waiver_url`) among others. This task lifts that mechanism into the
  regular invoice send and generalizes it to N persisted attachments.
- **Upload UI pattern exists.** `PayAppDetailModal.handleUploadWaiver`
  (`:196-218`) uploads to the `job-attachments` bucket (sanitized filename),
  `getPublicUrl`, then persists the URL to a DB column. We copy this shape.
- **No attachments table exists.** Attachments today are scalar `*_url` columns on
  rows (`invoices.pdf_url`, pay-app `pdf_url`/`sov_pdf_url`/`release_waiver_url`).
  There is no per-invoice attachment collection and no way to look back at "what
  documents went out with this invoice."
- **Send handler already re-derives sensitive data server-side.** `handleSend`
  (`Invoices.jsx:688-749`) sends only display fields; `send-invoice` loads
  recipients/amount from the DB (audit C9 / B36 pattern). Attachments will follow
  the same rule — the client never passes attachment URLs to the fn.

---

## 1. Problem / intent [LOCKED]

Chris needs to attach a **release waiver** (and, generally, one or more arbitrary
documents) to a regular invoice email, and needs those attachments **persisted**
so that looking at an invoice historically shows exactly what documents went out
with it. One invoice may carry **multiple** attachments at once — so this is a
collection (a table), not a single column. Ratified in the 2026-07-02 planning
conversation.

Scenario given: a partial invoice sent with a waiver, then the remaining-billing
invoice sent later with its own waiver. Each is a **separate `invoices` row**, so
each carries its own attachment set — no cross-invoice coupling needed.

---

## 2. The model to mirror (`send-pay-app`) [DERIVED]

`send-pay-app` is the working reference. It already does everything we need,
constrained to fixed columns; we generalize to a table:

| Concern | `send-pay-app` does | This plan does |
|---|---|---|
| Attachment source | fixed columns on pay-app/invoice rows | rows in new `invoice_attachments` table |
| SSRF defense | `isAllowedStorageUrl` allowlist (`:18-29`) | same helper, `job-attachments` bucket |
| Encode | `arrayBufferToBase64` (`:56`) | same helper |
| Resend field | `attachments: [...]` (`:357-374`) | same, built from N rows |
| Client trust | URLs re-derived from DB, body ignored | same — client passes nothing |

---

## 3. Invoice side today [DERIVED]

- `handleSend` (`Invoices.jsx:688-749`) → `supabase.functions.invoke("send-invoice", { body })`
  with display fields only.
- Send view UI: `Invoices.jsx:979-1034` (`view === "send"`), panels for Main /
  Viewers / Amount, then the "Send Invoice with Pay Link" button (`:1028`).
- `send-invoice` resolves recipients three ways (`:143-168`), sends MAIN
  (fatal on failure) then each VIEWER (non-fatal, collected to `warnings[]`),
  via `sendEmail(to, html)` (`:354-362`).

---

## 4. Proposed change

### 4.1 DB — new `invoice_attachments` table [LOCKED shape, DERIVED columns]

Authored in **`command-suite-db`** (SC no longer owns migrations — CLAUDE.md).
This section is the **spec**; the migration file is created and pushed there at
build time. Modeled column-for-column on `20260625120000_invoice_recipients.sql`
(same parent, same tenant/RLS pattern).

```sql
-- Invoice Attachments — documents emailed with an invoice, persisted so an
-- invoice's history shows exactly what went out with it. One invoice may have
-- many. RLS: standard 4-policy tenant pattern (authenticated, tenant-scoped).
-- No anon policy — the public invoice page does not list attachments (§6).
CREATE TABLE IF NOT EXISTS public.invoice_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id text NOT NULL
    REFERENCES public.invoices(id) ON DELETE CASCADE,
  file_url text NOT NULL,          -- public URL in job-attachments bucket
  file_name text NOT NULL,         -- original (sanitized) filename
  label text,                      -- e.g. 'Release Waiver' (freeform; may default to file_name)
  content_type text,               -- from the upload (best-effort)
  size_bytes bigint,               -- for the Resend total-size guard (§7)
  created_by uuid,                 -- auth.uid() of uploader (audit trail)
  created_at timestamptz NOT NULL DEFAULT now(),
  tenant_id uuid NOT NULL DEFAULT get_user_tenant_id()
    REFERENCES public.tenant_config(id)
);
CREATE INDEX IF NOT EXISTS idx_invoice_attachments_invoice_id
  ON public.invoice_attachments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_attachments_tenant_id
  ON public.invoice_attachments(tenant_id);
ALTER TABLE public.invoice_attachments ENABLE ROW LEVEL SECURITY;
-- 4 policies (select/insert/update/delete) TO authenticated,
-- USING/WITH CHECK (tenant_id = get_user_tenant_id()) — copy verbatim from
-- invoice_recipients migration.
```

**Storage:** reuse the existing **`job-attachments`** public bucket (already in
`send-pay-app`'s allowlist; already has a DELETE policy, migration
`20260420120000`). Path: `invoice-attachments/{invoice_id}/{timestamp}-{cleanName}`.
Sanitize filename `replace(/[^a-zA-Z0-9._-]/g, "_")` (CLAUDE.md storage rule).

### 4.2 UI — Attachments panel in the send view (`Invoices.jsx`) [LOCKED behavior]

Add an **Attachments** panel inside the `view === "send"` block (after the Amount
panel `:1021-1024`, before the send button `:1028`). Mirrors
`PayAppDetailModal` upload UX.

- **Load:** in the existing `loadContact` effect (or a sibling effect), fetch
  `invoice_attachments` for `invoice.id` ordered by `created_at`; hold in
  `attachments` state.
- **Add:** hidden `<input type="file" accept="application/pdf,.docx,.xlsx,.xls,image/*">`
  behind a styled label (copy `PayAppDetailModal:574-612` styling). On pick:
  sanitize name → `storage.from("job-attachments").upload(path, file, { contentType })`
  → `getPublicUrl` → `insert` into `invoice_attachments`
  `{ invoice_id, file_url, file_name, label, content_type, size_bytes, created_by }`
  → refresh list. `tenant_id`/`created_at` default server-side.
- **Label:** defaults to the filename; a small set of quick-pick chips
  (**Release Waiver**, **Lien Release**) set the label with one tap. Freeform
  edit allowed. _[DESIGN-OPEN: exact preset list — see §7.]_
- **Remove:** delete the `invoice_attachments` row **and** `storage.remove([path])`.
  ⚠️ `storage.remove` silently no-ops without a DELETE policy — `job-attachments`
  HAS one (`20260420120000`), so this works; **smoke-verify the file is actually
  gone**, don't trust the empty array (memory: storage-remove-silent-noop).
- Panel lists current attachments (label · filename · remove ✕). This same list
  component is reused for the historical view (§4.4).

### 4.3 Send handler (`handleSend`, `Invoices.jsx:688-749`) [LOCKED]

**No change to the request body.** Attachments are NOT passed to the edge fn —
`send-invoice` re-derives them from `invoice_attachments` by `invoice_id`
(same server-trust rule as recipients/amount, audit C9). This is deliberate: the
client cannot inject an arbitrary attachment URL into the outbound email.

### 4.4 Edge fn `send-invoice/index.ts` [LOCKED]

Lift the three mechanisms from `send-pay-app` and wire them in:

1. **Helpers (copy from `send-pay-app`):** `isAllowedStorageUrl` (`:18-29`) with
   `ALLOWED_STORAGE_BUCKETS = ["job-attachments", "signed-proposals"]`, and
   `arrayBufferToBase64` (`:56`). _[DESIGN-OPEN: copy vs. extract to
   `_shared/attachments.ts` — see §7; recommend copy now, file refactor.]_
2. **Load rows (tenant-scoped, once):** after the invoice tenant gate (`:53-55`),
   `select("file_url, file_name, label")` from `invoice_attachments`
   `.eq("invoice_id", invoiceId).eq("tenant_id", invoice.tenant_id)`. Service role
   bypasses RLS, so the explicit tenant filter is mandatory (matches the
   recipients read at `:109-113`).
3. **Validate + fetch + encode ONCE (not per recipient):** for each row, run
   `isAllowedStorageUrl(file_url)`. **Invalid or unfetchable → skip with a
   `warnings[]` entry, non-fatal** — a bad waiver must never block the pay-link
   email (the money is the critical payload). _[DESIGN-OPEN: non-fatal-skip vs.
   hard-fail; `send-pay-app` 400s on a present-but-invalid optional URL. Recommend
   non-fatal for invoices — flag for audit, §7.]_ Fetch each valid URL, base64,
   build `attachmentsPayload = [{ filename, content }]` **once** before the send
   loop, reuse for all recipients.
4. **Attach to sends:** extend `sendEmail(to, html)` → `sendEmail(to, html, attachments)`
   and pass `attachmentsPayload` to **both** the MAIN send (`:368`) and each
   VIEWER send (`:394`). _[DESIGN-OPEN: do viewers get the docs too? Recommend
   YES — a viewer's "copy for your records" should include the waiver. Flag §7.]_
5. **Sender notification (`:407-442`):** append an attachment list (names) to the
   paper-trail email, escaping `label`/`file_name` via the existing `esc` (`:301`).

### 4.5 Historical view (`Invoices.jsx` detail/PDF modal) [LOCKED]

Render the attachment list (reuse §4.2's component, read-only) on the invoice
**detail** view so opening any invoice shows the documents that went with it,
each a download link (`file_url`). This is the "look back and see what went out"
requirement. Attachments are **invoice-scoped, not send-event-scoped** — see the
re-send nuance in §7.

---

## 5. Files to touch

**`command-suite-db`** (migration authored + pushed here, at build):
- `supabase/migrations/<ts>_invoice_attachments.sql` — table + 2 indexes + 4 RLS
  policies (copy `invoice_recipients` migration).

**`sales-command`**:
- `src/pages/Invoices.jsx` — attachments state + load; upload/remove handlers;
  Attachments panel in send view (§4.2); historical list in detail view (§4.5).
- `supabase/functions/send-invoice/index.ts` — allowlist + base64 helpers; load
  `invoice_attachments`; validate/fetch/encode once; attach to main + viewer
  sends; list in sender notification (§4.4).
- `docs/BACKLOG.md` — new feature row (added this session).

**Not touched (kept scoped):** `send-pay-app`, `PayAppDetailModal`,
`PublicInvoicePage`, QB sync, Stripe path.

---

## 6. Out of scope / deferred [DERIVED]

- **Public invoice page** does not list attachments (no anon RLS policy). If the
  customer needs them on the web page later, that's a separate token-gated read.
- **Send-event granularity** (which attachment went in send #1 vs a re-send) — v1
  treats attachments as the invoice's current document set (§7).
- **`_shared/attachments.ts` extraction** (de-dup the helpers now duplicated in
  send-invoice + send-pay-app) — file as a follow-up refactor, not this task.
- **F12 "PandaDoc PDF attachment"** (BACKLOG) is an unrelated integration; not
  this.

---

## 7. Risks / open questions for audit

1. **Invalid/unfetchable attachment: skip-with-warning vs. hard-fail?** Recommend
   non-fatal skip (money is the critical payload). `send-pay-app` hard-fails a
   present-but-invalid optional URL — decide whether invoices should diverge.
2. **Viewers get attachments too?** Recommend yes. Confirm no case where a viewer
   should be denied a document the main got.
3. **Resend total-size limit (~40 MB, base64-inflated ~33% over raw).** N
   arbitrary user files can blow this. Need a guard: cap count and/or sum
   `size_bytes` before sending; surface a clear error at upload or send. Define
   the cap.
4. **Re-send nuance:** attachments are invoice-scoped, so adding a doc after a
   first send means the history reflects the *current* set, not literally what
   email #1 carried. Acceptable for v1? Or is per-send fidelity required?
5. **Copy vs. extract the storage helpers** — copying is faster but is the third
   copy of `isAllowedStorageUrl` drift risk.
6. **XSS:** `label`/`file_name` are user input; must be escaped everywhere they
   hit HTML (sender notification, historical view). Verify `esc`/React escaping
   on every sink.
7. **Public-bucket exposure:** files live in the public `job-attachments` bucket
   (URL is guessable-by-token only). Same model as existing waivers — acceptable,
   but confirm no attachment is sensitive beyond that bar.
8. **Storage DELETE no-op:** verify remove actually deletes (don't trust `[]`).

---

## 8. Build / deploy discipline

- **Migration:** author on its own branch in `command-suite-db`; `npm run db:push`
  there (runs safety + collision guards). **Sequence after any in-flight Schedule
  Command migration** — do not push while sch-command's `db:push` is mid-flight;
  whichever goes second rebases on `main` first (single shared ledger).
- **Edge fn:** `supabase functions deploy send-invoice --no-verify-jwt` (memory:
  edge-function-deployment). CORS unchanged (already `_shared/cors.ts`).
- **Post-deploy smoke (memory: edge-fn-post-deploy-smoke):** on a TEST-named job,
  attach a waiver → send to a TEST recipient → confirm (a) email arrives with the
  attachment, (b) `invoice_attachments` row exists, (c) historical list renders
  it, (d) remove actually deletes the file.
- **Gates:** `/buildvsplan` (spec-vs-code + live-schema reality) → `/code-review`
  → `/security-review` (storage allowlist, tenant scoping, email egress, RLS all
  touched — security review is required here).

---

## Audit manifest

_Seed manifest for `/runaudit`. May be regenerated by `/auditcriteria` (feature
mode) in the planning terminal before the audit round._

### Bottom line (plain English)
Add persisted, multi-file attachments to the regular invoice email by lifting the
proven `send-pay-app` attachment mechanism into `send-invoice`, backed by a new
tenant-scoped `invoice_attachments` table. The risk surface is email egress +
storage SSRF + tenant isolation, not novel logic.

### Round
Round 1 (fresh plan).

### Deployment context
Prod money path (invoices to customers). Shared Supabase ledger with a concurrent
Schedule Command build — migration must be sequenced (§8).

### Surface
`invoice_attachments` migration spec (§4.1); `send-invoice/index.ts` changes
(§4.4); `Invoices.jsx` send-view + detail-view changes (§4.2, §4.5).

### Layers touched
DB (new table + RLS), storage (job-attachments), edge fn (email egress + fetch),
React UI.

### New mechanisms introduced
First N-row attachment collection for invoices; first time `send-invoice` fetches
external URLs + emits Resend attachments.

### Cross-system reach
Resend (email), Supabase Storage (fetch), shared migration ledger.

### Irreversibility
Sends real customer email; migration on shared prod ledger.

### Known weak points
The §7 list — especially size limit (#3), skip-vs-fail (#1), helper drift (#5),
XSS sinks (#6).

### Suggested attack angles
1. Tenant isolation + SSRF: can a crafted `file_url` or cross-tenant
   `invoice_attachments` row reach the fetch/attach path?
2. Egress/DoS + correctness: oversized/many attachments, invalid URLs, viewer
   exposure, re-send fidelity.

### Suggested agent count: 3
DB/RLS · edge-fn security (SSRF/tenant/egress) · UI+correctness. 3 = sweet spot
per audit-sizing discipline.
