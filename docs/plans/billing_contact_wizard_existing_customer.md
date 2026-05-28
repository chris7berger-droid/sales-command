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
