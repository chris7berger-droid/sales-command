# Billing contact entered in the New Inquiry wizard doesn't appear on the customer detail page (existing-customer mode)

## Context

When a user runs the **New Inquiry wizard** against an **existing customer** and types a Billing Contact (Name / Phone / Email) on the contactInfo step, the customer detail page does **not** show that contact in its contacts list after save.

The new-customer branch of the same wizard already inserts a `customer_contacts` row with `role='Billing Contact'`. The existing-customer branch only updates the denormalized `customers.billing_*` columns — it never writes to `customer_contacts`. The customer detail page reads contacts from `customer_contacts` only, so the typed billing contact never appears there.

Background memory (verified against current code):
- `customer_contacts.role='Billing Contact'` is the canonical store; `customer_contacts.is_billing_contact` (added 2026-05-06) is a parallel flag. `ContactBillingPicker.isBilling` checks both via OR (`src/components/ContactBillingPicker.jsx:19-20`), so either column is sufficient for read-side discovery.
- `customers.billing_name/phone/email` are legacy denormalized columns kept in sync for back-compat with older read paths (e.g. `Customers.jsx:48-52` form fields, `send-invoice` resolver fallbacks). They are not what the customer detail page renders in the contacts section.

## §1 Root cause [LOCKED]

`src/components/NewInquiryWizard.jsx:309-325` — existing-customer branch of `handleSave`:

```js
if (data.customerMode === "existing" && customerId) {
  const update = {
    phone: data.contactPhone || null,
    email: data.contactEmail || null,
    contact_email: data.contactEmail || null,
    contact_phone: data.contactPhone || null,
    billing_terms: billingTermsNum,
    requires_pay_app: data.requiresPayApp,
  };
  if (!data.billingSourceContactId) {
    update.billing_same = data.billingSame;
    update.billing_name = data.billingSame ? null : data.billingName;
    update.billing_phone = data.billingSame ? null : data.billingPhone;
    update.billing_email = data.billingSame ? null : data.billingEmail;
  }
  await supabase.from("customers").update(update).eq("id", customerId);
}
```

This writes the four `billing_*` columns on `customers`. There is no corresponding `INSERT INTO customer_contacts`.

The new-customer branch at `:343-352` already does the right thing:

```js
if (customerId && !data.billingSame && data.billingName.trim()) {
  const { error: bcErr } = await supabase.from("customer_contacts").insert([{
    customer_id: customerId,
    name: data.billingName.trim(),
    phone: data.billingPhone || null,
    email: data.billingEmail || null,
    role: "Billing Contact",
    is_primary: true,
  }]);
  if (bcErr) alert(`Customer saved, but billing contact didn't save: ${bcErr.message}. Add it from the customer record.`);
}
```

Bug is the missing mirror of `:343-352` in the existing-customer branch.

### Why the picker doesn't compensate

`ContactBillingPicker` auto-locks the Billing Contact section only when a Billing Contact already exists on the chosen customer (`:85-93`). When no Billing Contact is on file, the picker falls back to **manual entry mode** (`renderBillingManual` at `:229-265`), which collects values into the wizard's state but does not write anywhere — the wizard is the writer. The picker's hint at `:259-263` ("add a Billing Contact to this customer's record so future jobs auto-fill") is currently false advertising for the existing-customer path: the entered values do not persist to `customer_contacts`.

### Customer detail page read path

`src/pages/Customers.jsx:504`:

```js
const { data } = await supabase.from("customer_contacts")
  .select("*").eq("customer_id", customer.id)
  .order("is_primary", { ascending: false }).order("name");
```

Confirms the contacts list is rendered from `customer_contacts`, not from `customers.billing_*`. The billing_* columns are read only by the edit-customer form fields (`Customers.jsx:48-52`) — separate surface, separate population.

## §2 Fix [LOCKED]

One INSERT block in `src/components/NewInquiryWizard.jsx`, immediately after the existing-customer `customers` UPDATE at `:324` (and before the `if (data.customerMode === "new") { ... }` block at `:326`):

```js
if (
  data.customerMode === "existing" &&
  customerId &&
  !data.billingSourceContactId &&
  !data.billingSame &&
  data.billingName.trim()
) {
  const { error: bcErr } = await supabase.from("customer_contacts").insert([{
    customer_id: customerId,
    name: data.billingName.trim(),
    phone: data.billingPhone || null,
    email: data.billingEmail || null,
    role: "Billing Contact",
    is_primary: false,
  }]);
  if (bcErr) alert(`Job saved, but billing contact didn't save: ${bcErr.message}. Add it from the customer record.`);
}
```

### Intentional deltas from the new-customer mirror

| Field | New-customer (`:343-352`) | Existing-customer (new block) | Why |
|---|---|---|---|
| Gate | `!data.billingSame && data.billingName.trim()` | adds `customerMode === "existing"` + `!data.billingSourceContactId` | Don't double-insert when picker already locked from existing Billing Contact (`billingSourceContactId != null` means the source row already exists in `customer_contacts`). |
| `is_primary` | `true` | `false` | Existing customers likely have a primary contact already; the new billing contact shouldn't displace it. The customer detail page's ContactModal enforces single-primary by demoting siblings on save (`Customers.jsx:187`), but the wizard doesn't run that demotion path and shouldn't compete for the role. |
| `is_billing_contact` flag | not set (matches new-customer pattern) | not set | Discoverability via `isBilling` OR-check (`ContactBillingPicker.jsx:19-20`) needs only `role='Billing Contact'`. Setting both is correct long-term but is a separate cross-surface consistency pass — out of scope here (see §6). |

## §3 Side fix — additionalContacts dedup gate [LOCKED]

`NewInquiryWizard.jsx:411-427` dedupes a typed Billing Contact against the additionalContacts list to prevent two `role='Billing Contact'` rows when a user types one in the picker AND adds another via "+ Add Contact". The current dedup gate at `:413`:

```js
const billingKey = data.customerMode === "new" && !data.billingSame
  ? `${data.billingName.trim().toLowerCase()}|${(data.billingEmail || "").trim().toLowerCase()}`
  : null;
```

After §2 ships, the existing-customer path also inserts a typed billing contact, so it can collide with additionalContacts in the same way. Loosen the gate to fire for both modes when a new billing contact row will be written:

```js
const billingKey = (
  !data.billingSame &&
  data.billingName.trim() &&
  !(data.customerMode === "existing" && data.billingSourceContactId)
)
  ? `${data.billingName.trim().toLowerCase()}|${(data.billingEmail || "").trim().toLowerCase()}`
  : null;
```

Reading: build a dedup key whenever a new Billing Contact row is being written by the wizard's own logic — in new-customer mode (always), or in existing-customer mode UNLESS the picker locked from a pre-existing Billing Contact row (in which case nothing new is inserted, so no dedup is needed).

## §4 Verification (third-party checkable)

Run on a non-prod TEST customer (don't dirty real customer data):

1. Pick or create a TEST customer with **zero** existing Billing Contact rows (`SELECT * FROM customer_contacts WHERE customer_id = '<id>' AND (role='Billing Contact' OR is_billing_contact = true);` returns 0 rows).
2. Open New Inquiry wizard → "Use Existing Customer" → pick the TEST customer.
3. On contactInfo step, the Billing Contact section in `ContactBillingPicker` should be in manual entry mode (no lock chrome). Type Name + Phone + Email.
4. Complete the wizard and save the job.
5. **Check A — UI**: open the customer detail page for the TEST customer. The contacts list should show a row matching the typed name with the "Billing Contact" role badge. Position depends on `is_primary` ordering at `Customers.jsx:504`.
6. **Check B — DB**: `SELECT id, name, phone, email, role, is_primary, is_billing_contact, created_at FROM customer_contacts WHERE customer_id = '<id>' ORDER BY created_at DESC LIMIT 5;` — top row should match the typed values with `role='Billing Contact'`, `is_primary=false`.
7. **Check C — picker auto-fill on next job**: open New Inquiry wizard again → same existing customer. The Billing Contact section should now be in **locked** mode displaying the row written in step 4. Confirms `pickBillingContact` (`ContactBillingPicker.jsx:23-29`) sees the new row.

Optional regression smoke (won't take 5 min):
- Repeat with a customer that already HAS a Billing Contact on file. Picker should lock immediately. Save the job and confirm NO new row was inserted (the §2 gate's `!billingSourceContactId` check works).
- Repeat with `billingSame=true` (no separate billing contact). Save the job and confirm NO `customer_contacts` row was inserted (the `!billingSame` and `billingName.trim()` gates work).

## §5 Risks / what might break

- **Duplicate Billing Contact rows.** If `pickBillingContact` returns null for a customer that nonetheless has a row matching by role or flag (e.g. a row inserted under a race with another wizard session), the §2 INSERT would create a second Billing Contact. Mitigation: rare race, customer detail page lets user delete the dup. Not blocking.
- **`is_primary: false` clobbers when there are zero contacts.** If the existing customer somehow has no other contacts (rare but possible — `Customers.jsx:454` initializes `contacts=[]` and the wizard's existing-customer flow doesn't enforce at least one contact existing), the new Billing Contact would be inserted with `is_primary=false` and the customer ends up with zero primary contacts. The customer detail page handles a missing primary (ordering still works), but the `is_primary=false` choice is slightly worse than `null`-default could be. Trade-off accepted because the dominant case is "customer already has at least one primary, don't displace it." If this becomes an issue, follow-up adds a "first-contact" detection that promotes the Billing Contact to primary only when no other contact exists.
- **Wizard alert UX.** Error path uses `alert()` to surface a save failure on a money-bearing surface, mirroring the existing new-customer error at `:352`. Consistent with current pattern; if `alert()` is later replaced with a toast, both call-sites should change together.
- **No write to `is_billing_contact` flag.** Downstream consumers that filter purely on `is_billing_contact = true` (rather than the OR-check used by `ContactBillingPicker.isBilling`) would not see the new row. As of this writing, the only known purely-flag-based reader is the `Customers.jsx` ContactModal initializer at `:170` (`is_billing_contact ?? (role === "Billing Contact")`) — already falls back to role check. Audit angle for ratification.
- **RLS.** `customer_contacts` has tenant-scoped RLS policies (memory: standard 4-policy pattern with `tenant_id` default + FK). The insert relies on the row's `tenant_id` being populated via column default and matching the authenticated caller's tenant. Verify on TEST that the policy doesn't silently drop the row. (If RLS denies, the `error: bcErr` branch fires and the alert is shown — visible failure, not silent.)

## §6 Out of scope

Filed but not touched here. Pick up in a separate loop:

1. **`is_billing_contact` flag symmetry** — the new-customer wizard insert (`:344-351`) sets `role` only; the existing-customer fix (§2) matches. The Customers.jsx ContactModal write path (`:182-185`) sets BOTH `role` and `is_billing_contact`. Cross-surface consistency pass would update both wizard inserts to set both columns, and consider a backfill for legacy rows where role='Billing Contact' but `is_billing_contact=false`.
2. **New-customer `is_primary: true` unconditional** — assumes no other contacts exist at customer-creation time, which is true via the wizard's own write order but not invariant if the customer-creation path ever changes. Audit angle.
3. **Picker hint copy** (`ContactBillingPicker.jsx:259-263`) — currently always says "add a Billing Contact… so future jobs auto-fill." Once §2 ships, that statement becomes true even from the wizard (not just the customer record). Tighten copy in a follow-up if it confuses anyone.
4. **`additionalContacts` general dedup** — current dedup logic is name+email key; doesn't catch "same person typed slightly differently" (Joe vs Joseph). Out of scope; same problem the customer page already has.

## §7 Estimate

- Code: ~15 min (one INSERT block + one dedup gate update, both in `src/components/NewInquiryWizard.jsx`)
- Smoke verification on TEST customer: ~15 min (Checks A/B/C + 2 regression cases)
- Total: ~30 min, matching the ERD lock (Loop #28, FEAR-CATEGORY: TIME).

## §8 Files touched

- `src/components/NewInquiryWizard.jsx` (sole code change)

## §9 Open questions

- `is_primary: false` vs leave field unset (default `false` per schema) — same DB outcome, but explicit-false is more readable. Recommendation: keep explicit `false`. **Status:** [DESIGN-OPEN — minor, locked at code time]
- Should the §2 INSERT also set `is_billing_contact: true` for forward-compatibility, even though the new-customer mirror doesn't? Trade-off: closer to canonical billing-contact pattern (per memory) vs. asymmetry with the new-customer branch. Recommendation: stay symmetric in this loop, file a follow-up for both branches in one pass (§6 item 1). **Status:** [DESIGN-OPEN — locked to "stay symmetric"]

(No items requiring blocking input from Chris.)

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-05-27. Consumed by `/multiagentaudit` to size the adversarial audit pass._

### Round
- Current round: 1
- Plan revision under audit: be239b2
- Findings trend: n/a — round 1

### Prior rounds
none — this is round 1

**Briefing for agents**: do NOT re-find issues from prior rounds. Each round's revision-pass commit message is the canonical record of what was addressed. Attack ONLY material new to the plan revision under audit.

**Plateau signal**: if the findings trend shows three consecutive rounds without a meaningful drop in count (≥30% reduction), the audit pass is in plateau. The plateau is usually scope creep — each revision answers prior findings by ADDING mechanism, which adds surface, which produces new findings. `/multiagentaudit` is required to consider a scope cut when it sees a plateau; the manifest just makes the pattern visible.

### Surface
- Total lines: 177
- Sections: 9
- [LOCKED] decisions: 3
- [DESIGN-OPEN] items: 2
- [OPEN] items: 0

### Layers touched
- UI / components (NewInquiryWizard.jsx wizard surface, ContactBillingPicker.jsx read flow)
- Data layer (Supabase client INSERT to `customer_contacts`, UPDATE to `customers`)
- RLS / auth / multi-tenancy (new write traverses existing `customer_contacts` tenant-scoped policies)

### New mechanisms introduced
- New columns: none
- New tables: none
- New helpers / hooks: none
- New triggers / RLS policies: none
- New routes / endpoints: none
- New jobs / cron / webhooks: none

### Cross-system reach
none

### Irreversibility
none — all changes reversible (no migrations, no backfills, no public API changes, no cross-repo schema contracts)

### Known weak points

Lifted from plan §5, plus additions:

- **Duplicate Billing Contact rows on concurrent wizard sessions.** Two sessions, both seeing zero Billing Contact on file, both insert. No DB-level uniqueness enforces single Billing Contact per customer. Plan §5 flags as low-risk but does not propose a mitigation.
- **`is_primary: false` chosen for existing-customer insert; new-customer mirror uses `is_primary: true`.** Plan §2's delta table justifies as "existing customers likely have a primary already." Edge case: existing customer with zero contacts on file would now have a Billing Contact row but no primary. Plan acknowledges in §5 but defers fix.
- **Asymmetric writer set across wizard / Customers.jsx ContactModal / additionalContacts loop.** New-customer branch (`:344-351`) and §2 existing-customer fix set `role` only. ContactModal (`Customers.jsx:182-185`) sets both `role` and `is_billing_contact`. Reads via OR (`ContactBillingPicker.jsx:19-20`) tolerate this, but any purely-`is_billing_contact`-based reader misses wizard-inserted rows. Plan §6 item 1 flags but defers.
- **`customers.billing_*` denormalized columns kept in sync, but customer_contacts is the canonical store per memory.** After fix, the wizard writes to BOTH (UPDATE billing_* + INSERT customer_contacts). Divergence is possible if a future code path updates one but not the other. Plan does not address sync invariant.
- **Tenant resolution on the INSERT relies on `customer_contacts.tenant_id` column default.** Plan §5 risk #5 raises this. Per memory the canonical pattern is `tenant_id` with FK + default + 4 standard policies. Audit should confirm `customer_contacts` actually follows this pattern (verify schema + policies in code).
- **Wizard runs as authenticated user (not service role).** Cross-tenant attack surface: can a sales rep in tenant A pick a customer in tenant B (via `data.customerId` injected somehow) and write a Billing Contact there? Picker fetches contacts via `customer_id` filter — if RLS on `customer_contacts` correctly scopes `tenant_id = caller.tenant_id`, the picker's fetch returns nothing (it appears to be a fresh customer) and the new INSERT's `tenant_id` default resolves to caller's tenant, while `customer_id` points at tenant B's customer. Result: orphan `customer_contacts` row with mismatched `tenant_id` vs `customers.tenant_id`. Plan does not flag this.
- **Wizard alert UX uses `alert()` for save failures on a money-bearing surface.** Mirrors existing pattern at `:352` and `:427`. Plan §5 flags but does not propose alternative.
- **Picker hint copy at `ContactBillingPicker.jsx:259-263`** ("add a Billing Contact… so future jobs auto-fill") becomes accurate after fix from wizard path; was already accurate from Customers.jsx ContactModal path. No fix proposed.

### Open questions
- Count: 2 (see §9)
- Highest-pressure:
  1. Should §2 INSERT set `is_billing_contact: true` for forward-compat? Plan defers as "stay symmetric with new-customer mirror" but the new-customer mirror itself doesn't set it — both wizard branches drift from the ContactModal pattern.
  2. `is_primary: false` vs unset (default false). Same DB outcome; readability question. Locked at "explicit false."

### Suggested attack angles (3 total)

1. **State model / write-path coverage** — covers UI/components + Data layer. Required reading: `src/components/NewInquiryWizard.jsx:280-430` (handleSave full body, both customer-mode branches, additionalContacts loop), `src/components/ContactBillingPicker.jsx:45-100` (lock/unlock state machine, `pickBillingContact`), `src/pages/Customers.jsx:162-200` (ContactModal write path for comparison). Specific pressure: does the §2 gate (`customerMode === "existing" && customerId && !billingSourceContactId && !billingSame && billingName.trim()`) miss any path where a new Billing Contact should be written? Does the §3 dedup gate correctly handle the case where additionalContacts contains a `role='Billing Contact'` row entered by the user with a different name+email than the picker row? After §2 fix, does the `customers.billing_*` UPDATE + `customer_contacts` INSERT pair produce a divergent state in any scenario (one succeeds, the other fails — what does the wizard show)? Does the empty-string vs null handling on `billing_name`/`billing_phone`/`billing_email` at `:320-322` create data-quality drift?

2. **RLS / multi-tenancy / cross-tenant integrity** — covers RLS/auth layer. Required reading: most recent `customer_contacts` RLS policy migrations (grep `customer_contacts` in `supabase/migrations/`), `CLAUDE_RLS.md`, and the cross-tenant attack vector flagged in known weak points above (sales rep in tenant A pickable customer in tenant B → orphan customer_contacts row with mismatched tenant_id). Specific pressure: does `customer_contacts` actually have the canonical 4-policy + tenant_id default pattern, or did it deviate? Is there any path where the INSERT's `tenant_id` default could resolve to a different tenant than `customers.tenant_id` for the same `customer_id`? Are there server-side checks (trigger, RPC, FK) that prevent the cross-tenant mismatch, or is it caller-tenant-trust all the way down? What's the failure mode if RLS silently denies the INSERT (no row, no alert because supabase-js doesn't error on RLS-filtered writes)?

3. **Framework fit / cross-surface consistency** — covers code-pattern consistency. Required reading: all customer_contacts insert sites (`src/components/NewInquiryWizard.jsx:344-352, :424-427`, §2/§3 of this plan; `src/pages/Customers.jsx:182-191`), `ContactBillingPicker.isBilling` (`:19-20`) and any caller that filters by `is_billing_contact` alone, and `send-invoice` / `send-pay-app` / `qb-*` edge fns that resolve billing contact (grep "is_billing_contact" and "Billing Contact" in `supabase/functions/`). Specific pressure: is the role/is_billing_contact asymmetry going to bite a downstream consumer the audit can name? Does the existing-customer wizard now produce semantically equivalent Billing Contact rows to the other two paths, or is there a subtle field divergence? Is the picker's hint copy accurate post-fix? Should the wizard's two `alert()` call-sites be the place where a future toast migration starts, or are they fine as-is?

### Suggested agent count: 3

Rationale: narrow surface (single file, zero novel mechanisms, no migrations) but three independent attack vectors deserve isolated agents — write-path completeness, multi-tenant integrity, and cross-surface pattern consistency don't compress cleanly into 2 angles without losing the cross-tenant injection question to a "framework fit" generalist.

