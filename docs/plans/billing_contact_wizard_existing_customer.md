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

## §2 Fix [LOCKED — revised in Plan Revision Pass 1]

**Round-1 audit response.** Original §2 was a single INSERT mirror of `:343-352`. Audit round 1 surfaced silent-failure modes, cross-tenant write surface, duplicate-on-race risk, and cross-surface symmetry gaps the simple mirror did not address. Revised spec below adds preflight gates and adopts the canonical ContactModal pattern (`Customers.jsx:182-185`) for both wizard branches. See §10 for finding → revision mapping.

### §2.1 Customer ownership preflight (existing-customer mode)

Before the `customers` UPDATE at `:309-324`, verify the customer is visible to the caller:

```js
if (data.customerMode === "existing" && customerId) {
  const { data: own } = await supabase.from("customers")
    .select("id").eq("id", customerId).maybeSingle();
  if (!own) { setError("Customer not in your workspace."); setSaving(false); return; }
  // ...existing UPDATE block follows
}
```

Closes **A2**-class cross-tenant injection: RLS on `customers` returns no row for a `customerId` from another tenant, so the wizard hard-stops before any write rather than writing a `customer_contacts` row whose `tenant_id` (caller's, via column default) mismatches `customers.tenant_id`. Hand off cross-tenant defense to RLS rather than caller-trust. Durable trigger-based enforcement is filed in §6.

### §2.2 Error-check the existing-customer UPDATE

```js
const { error: cuErr } = await supabase.from("customers").update(update).eq("id", customerId);
if (cuErr) { setError(`Couldn't update customer: ${cuErr.message}`); setSaving(false); return; }
```

Prevents the `call_log.insert` at `:383` from running on a half-applied save (current code ignores `update`'s return value and proceeds regardless).

### §2.3 Empty-string → null normalize on `customers.billing_*`

Both branches. Existing-customer UPDATE at `:320-322`:

```js
update.billing_name  = data.billingSame ? null : (data.billingName  || null);
update.billing_phone = data.billingSame ? null : (data.billingPhone || null);
update.billing_email = data.billingSame ? null : (data.billingEmail || null);
```

Same `|| null` pattern in the new-customer INSERT payload at `:333-335`. Closes **E1**: current code writes empty strings when user toggles "separate billing contact" then leaves the fields blank, producing rows where `billing_name = ''` ≠ `billing_name IS NULL` — confuses downstream filters and the picker's `pickBillingContact()` fall-through.

### §2.4 Preflight Billing Contact SELECT + conditional INSERT (both branches)

```js
const writeBillingContact =
  !data.billingSame &&
  data.billingName.trim() &&
  (data.customerMode === "new" ||
    (data.customerMode === "existing" && !data.billingSourceContactId));

if (writeBillingContact) {
  const { data: existingBC, error: bcCheckErr } = await supabase.from("customer_contacts")
    .select("id")
    .eq("customer_id", customerId)
    .or("role.eq.Billing Contact,is_billing_contact.eq.true");

  if (bcCheckErr) {
    setError(`Couldn't check existing billing contact: ${bcCheckErr.message}`);
    setSaving(false);
    return;
  }

  if (!existingBC || existingBC.length === 0) {
    const isPrimary = data.customerMode === "new"; // existing customers may already have a primary
    const { data: bcRow, error: bcErr } = await supabase.from("customer_contacts").insert([{
      customer_id: customerId,
      name: data.billingName.trim(),
      phone: data.billingPhone || null,
      email: data.billingEmail || null,
      role: "Billing Contact",
      is_billing_contact: true,
      is_primary: isPrimary,
    }]).select("id");

    if (bcErr || !bcRow || bcRow.length === 0) {
      setError(`Couldn't save billing contact${bcErr ? `: ${bcErr.message}` : " (no row returned — RLS or trigger may have blocked the insert)"}.`);
      setSaving(false);
      return;
    }
  }
  // existingBC.length > 0 → stale Billing Contact on file: skip insert, no error.
  // The picker would not have rendered manual mode in this case (it auto-locks
  // when pickBillingContact() finds a row). Reaching this branch means the
  // picker fetch returned [] but a Billing Contact row exists — race window or
  // RLS-shadow row. Skipping is correct: don't shadow the existing row.
}
```

Closes:
- **K1 + D2**: duplicate-row prevention via preflight SELECT (race or stale-state cases that would otherwise create a second `role='Billing Contact'` row).
- **F1 stale-row footnote**: if a Billing Contact exists but the picker rendered manual mode anyway (RLS shadow, race, edited contacts.json out-of-band), skip the insert rather than create a contradicting row.
- **Silent INSERT failure**: `.select("id")` forces detection of RLS-filtered writes — Supabase JS does not error when an INSERT is filtered to zero rows by RLS, so an unchecked insert presents as success when the row never landed. Checking `bcRow.length === 0` closes the silent path.
- **Cross-surface asymmetry**: setting BOTH `role='Billing Contact'` AND `is_billing_contact: true` matches the canonical ContactModal write at `Customers.jsx:182-185`. Same change applies to the new-customer mirror at `:344-351`. Closes §6 item 1 from the round-0 plan.

### §2.5 New-customer mirror — same shape

The new-customer branch INSERT at `:344-351` updates in parallel:

```js
const { data: bcRow, error: bcErr } = await supabase.from("customer_contacts").insert([{
  customer_id: customerId,
  name: data.billingName.trim(),
  phone: data.billingPhone || null,
  email: data.billingEmail || null,
  role: "Billing Contact",
  is_billing_contact: true,
  is_primary: true, // new customer has no other contacts at this point
}]).select("id");
if (bcErr || !bcRow || bcRow.length === 0) {
  setError(`Couldn't save billing contact${bcErr ? `: ${bcErr.message}` : ""}.`);
  setSaving(false);
  return;
}
```

Adopts both columns + `.select("id")` + `setError` (closes §2.6's alert→setError migration for this site too). The new-customer preflight SELECT can be skipped — a fresh customer has no contacts by construction — but the failure check is mandatory.

### §2.6 Replace `alert(...)` with `setError(...)`

Both existing-customer (§2.4) and new-customer (§2.5) billing-contact error paths use `setError` matching the file's convention at `:341` (existing error reporter for the new-customer customers INSERT). The `:352` alert is replaced. Failure halts the wizard with a visible inline error and `setSaving(false)`; user can retry from the live form state.

### §2.7 Scope honesty — when §2 actually fires

The picker's lock state machine (`ContactBillingPicker.jsx:85-93`) auto-locks the Billing Contact section when `pickBillingContact()` returns a row, and the picker has **no unlock affordance**. So in the existing-customer branch, §2.4's `writeBillingContact` evaluates true only when:

- The customer has zero Billing Contact rows on file (picker rendered manual mode), AND
- The user typed at least a name.

The "user wants to override an existing Billing Contact through the wizard" case does not exist in the current UX. The picker would have locked and pre-populated the existing values; manual entry was never reachable. A picker unlock affordance is filed in §6 — once added, §2.4's preflight already handles the override case correctly by skipping the insert (preserving the existing row) and letting the override happen via a separate edit on the customer detail page.

For the new-customer branch, §2.5 fires whenever `!billingSame && billingName.trim()` — no preflight needed.

## §3 Side fix — additionalContacts dedup [LOCKED — revised in Plan Revision Pass 1]

**Round-1 audit response.** Original gate keyed on `name+email` match, missing the case where the user typed a Billing Contact in the picker AND added a *differently-named* "Billing Contact" via "+ Add Contact". Simpler and stricter rule: when the wizard will write a Billing Contact row via §2, drop ALL `additionalContacts` with `role === 'Billing Contact'`. Closes **D1**.

Replace `:411-427` body's filter logic with:

```js
if (customerId && data.additionalContacts.length > 0) {
  const willWriteBilling =
    !data.billingSame &&
    data.billingName.trim() &&
    (data.customerMode === "new" ||
      (data.customerMode === "existing" && !data.billingSourceContactId));

  const newContacts = data.additionalContacts.filter(c => {
    if (!c.name?.trim()) return false;                              // drop empties
    if (willWriteBilling && c.role === "Billing Contact") return false; // dedup all role-billing rows
    return true;
  });

  if (newContacts.length > 0) {
    const { error: acErr } = await supabase.from("customer_contacts").insert(
      newContacts.map(c => ({
        customer_id: customerId,
        name: c.name.trim(),
        phone: c.phone || null,
        email: c.email || null,
        role: c.role,
        is_billing_contact: c.role === "Billing Contact",
      }))
    );
    if (acErr) {
      setError(`Couldn't save additional contacts: ${acErr.message}.`);
      setSaving(false);
      return;
    }
  }
}
```

Two intentional changes beyond the dedup loosening:

- **`is_billing_contact` derived from role on each additionalContacts row.** If the user picked "Billing Contact" in the role dropdown for a Contact 2/3/N entry, set both columns — same canonical pattern as §2.
- **`setError` + halt** instead of `alert` (mirrors §2.6).

Picker-locked case (`data.billingSourceContactId` set → existing Billing Contact on file → §2 INSERT skipped) still allows additionalContacts Billing Contact rows: rare, semantically "user explicitly adds a secondary billing contact" — the OR-check at `ContactBillingPicker.isBilling:19-20` would surface both rows the next time the picker runs and `pickBillingContact` would resolve to the first by `created_at` order. Acceptable.

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
- Repeat with a customer that already HAS a Billing Contact on file. Picker should lock immediately. Save the job and confirm NO new row was inserted (the §2 gate's `!billingSourceContactId` check + §2.4 preflight both prevent the write).
- Repeat with `billingSame=true` (no separate billing contact). Save the job and confirm NO `customer_contacts` row was inserted (the `!billingSame` and `billingName.trim()` gates work).

### PRP1 additions — defensive smoke (5–10 min)

Round-1 audit added defensive code paths. Smoke them:

- **D1 — ownership preflight.** Open dev console; force-edit the wizard state to set `customerMode='existing'` with a `customerId` that does not belong to the caller (use a known TEST customer id from a different tenant on a staging project, or simulate by manually nulling RLS on the local supabase shell). Save: wizard should halt with "Customer not in your workspace." inline error. `customers` and `customer_contacts` writes should NOT fire.
- **D2 — UPDATE error halts wizard.** Briefly drop `UPDATE` permission on `customers` for the authenticated role (or simulate by editing a non-existent column into `update` payload). Save: wizard halts with "Couldn't update customer: …" — `call_log.insert` should NOT have fired. Restore permissions.
- **D3 — preflight SELECT skip path.** Manually insert a `customer_contacts` row with `role='Billing Contact'` on a TEST customer, then bypass the picker's auto-lock (e.g. set `data.billingSourceContactId = null` in dev console after the picker rendered). Save with typed manual values. Confirm: NO new `customer_contacts` row was inserted, NO error shown, job saved successfully. This is the §2.4 stale-row path.
- **D4 — both columns set.** After a clean §4 step-4 save, run `SELECT role, is_billing_contact FROM customer_contacts WHERE customer_id = '<id>' ORDER BY created_at DESC LIMIT 1` — verify `role='Billing Contact'` AND `is_billing_contact=true`. Repeat for a new-customer save: same result.
- **D5 — setError replaces alert.** Force any §2 INSERT failure (e.g. drop INSERT permission on `customer_contacts` briefly). Save: confirm the error renders as an inline `setError` panel above the action row, NOT a browser `alert()` popup. `setSaving(false)` keeps the form interactive.

## §5 Risks / what might break

Updated post-Plan Revision Pass 1. Findings closed in §2/§3 are removed; remaining risks listed honestly.

- **Race window: preflight SELECT → INSERT.** Two wizard sessions on the same customer could both see zero Billing Contact, both reach the INSERT, and produce two rows. Acceptable for the bug's scope (rare in practice — single sales rep per customer is the dominant case), and customer detail page UI supports deleting duplicates. DB-level prevention (unique partial index on `(customer_id) where role='Billing Contact' or is_billing_contact=true`) is a §6 follow-up.
- **`alert` → `setError` UX regression.** Inline error replaces the popup. Users accustomed to the popup may miss the inline message. Mitigation: error halts the wizard (`setSaving(false)` + early return), so the form stays open with the error visible above the action row at `:341`. No silent drop.
- **`is_primary: true` in new-customer mode** still assumes no other contacts exist at customer-creation time. True via the wizard's own write order (customers INSERT → optional billing contact INSERT → additional contacts INSERT all in one flow), but if a future code path creates a customer + a primary contact before this branch runs, the new Billing Contact would be a second primary. Not currently reachable.
- **RLS shadow / preflight false-negative.** If `customer_contacts` RLS filters out a Billing Contact row that exists on `customer_id` but for a different tenant (shouldn't happen post-A1 follow-up, but possible today), the preflight SELECT returns `[]` and §2.4 proceeds to INSERT. The INSERT's `tenant_id` default would be caller's tenant; result is two rows with the same `customer_id` but different tenants. The §2.1 ownership check prevents this when `customers` is already cross-tenant-filtered, but if the data is mis-tagged (customer in tenant A, existing Billing Contact in tenant B), the preflight reads only the rows the caller can see, so §2.4 inserts. The A1 trigger filed in §6 closes this durably.
- **`select("id")` reliability for RLS detection.** Supabase JS returns `data: []` (not error) when RLS filters an INSERT to zero rows. Treating `bcRow.length === 0` as failure works IF Supabase's behavior is consistent across versions. If a future client release returns `null` data instead of `[]`, the check `!bcRow || bcRow.length === 0` covers both. Tested empirically on current client version via the C9 fix work in 2026-05-09.

## §6 Out of scope

Updated post-Plan Revision Pass 1. Items closed in §2/§3 removed; new follow-ups surfaced by audit round 1 added. Pick up in separate loops.

### Durable defenses (file as security-tier backlog rows)

1. **Trigger to enforce `customer_contacts.tenant_id = customers.tenant_id`** (closes A1 durably). Cite the existing `delete_customer` `RAISE EXCEPTION 'TENANT_MISMATCH'` pattern (`supabase/migrations/20260430120000_customer_delete_merge.sql`). Trigger on BEFORE INSERT OR UPDATE on `customer_contacts` that joins `customers` by `customer_id` and raises if `tenant_id` mismatches. Mirrors the H4 trigger pattern on `proposal_signatures` (`20260508120000_proposal_signatures_tenant_id_trigger.sql`). ~1h including migration + scratch test. **Blocks F7** (multi-tenant onboarding) along with the rest of the H-tier security set.
2. **`send-invoice` / `send-pay-app`: add `.eq("tenant_id", caller.tenantId)` to `customer_contacts` reads** (A2 amplifier defense-in-depth). Currently relies on `customers.tenant_id` filter upstream; explicit scope on the contact read is belt-and-suspenders. Same shape as the C9 fix at `supabase/functions/send-pay-app/index.ts` (commit on 2026-05-09). ~30 min per fn.
3. **DB-level uniqueness on Billing Contact per customer** — partial unique index on `customer_contacts(customer_id) WHERE role='Billing Contact' OR is_billing_contact=true`. Closes the §5 race window durably and lets §2.4's preflight collapse to a simple INSERT ON CONFLICT DO NOTHING pattern in a future cleanup. Migration + repair on existing dups. ~half-day.

### Cross-surface symmetry sweep

4. **`ContactModal` (Customers.jsx) mirror to `customers.billing_*`** (closes H1). Currently, editing a Billing Contact in ContactModal updates `customer_contacts` but does not propagate back to the legacy `customers.billing_*` columns. After §2 ships, the wizard writes both; ContactModal's edit path should too, otherwise the two surfaces drift on edit. ~1h.
5. **`CallLogDetail.jsx:121` — change role-only filter to OR-pattern** (closes G1). Less urgent post-§2.4 (both columns now set on new wizard writes), but legacy rows with `role='Billing Contact'` but `is_billing_contact=false` could be misfiltered by purely-flag-based downstream readers. Quick audit of downstream surfaces + apply OR-check where role-only matches exist. ~30 min.
6. **Extract `pickBillingContact` to `src/lib/contacts.js` + `supabase/functions/_shared` twin** (G2). Currently lives only in `ContactBillingPicker.jsx:23-29`; edge fns reimplement the lookup inconsistently. Shared util closes the asymmetry permanently. ~1h.

### UX

7. **Picker unlock affordance** for the existing-Billing-Contact case. Audit-round-1 surfaced that §2 narrows to "no existing Billing Contact on file" because the picker has no UI to override. Add an unlock button on the locked-billing render at `ContactBillingPicker.jsx:200-228` that flips to manual mode and clears `billingSourceContactId`. Once added, §2.4's preflight already handles the override case correctly (skips insert, preserves existing row). ~1h.
8. **`billing_same` semantics: refuse, delete, or deprecate** (F1 blocker). The `billingSame` toggle's meaning is murky — when `true` it nulls `customers.billing_*` (implying "no separate billing contact"), but the wizard does not delete an existing `customer_contacts` row with `role='Billing Contact'` if one exists. Decide: should `billingSame=true` block-and-warn ("you have a Billing Contact on file; uncheck to keep it"), delete the row, or be deprecated entirely in favor of "presence of Billing Contact row IS the source of truth"? Planning task before code. ~half-day planning.
9. **`additionalContacts` general dedup** — current dedup is per-row name+email key; doesn't catch slight variations ("Joe" vs "Joseph"). Out of scope; same problem `Customers.jsx` already has on the ContactModal create flow.
10. **Picker hint copy** (`ContactBillingPicker.jsx:259-263`) — accurate post-§2; tighten phrasing if user feedback surfaces confusion. ~10 min.

### Observability

11. **`updated_at` + audit log on `customer_contacts`** (closes M2). Most tenant tables have the `updated_at timestamptz` trigger pattern + an event log; `customer_contacts` does not. Add `updated_at` column + standard trigger from `supabase/migrations` template, optionally append-only event log table for billing-contact changes (audit trail for money-bearing writes). Migration-tier work, ~2h.

## §7 Estimate

Updated post-Plan Revision Pass 1. Surface grew (both wizard branches touched, preflights + error paths + both columns + alert→setError migration), but all changes remain in one file.

- Code: ~35 min (§2.1 ownership preflight + §2.2 UPDATE error check + §2.3 empty-string normalize × 2 sites + §2.4 preflight + conditional INSERT + §2.5 new-customer mirror + §2.6 alert→setError × 2 sites + §3 dedup rewrite, all in `src/components/NewInquiryWizard.jsx`)
- Smoke verification on TEST customers: ~25 min (§4 Checks A/B/C + 4 regression cases — existing-customer-with-no-billing, existing-customer-with-billing-already, new-customer, billingSame=true)
- Total: ~60 min. Doubles the ERD lock estimate (Loop #28 was 30 min). FEAR-CATEGORY: TIME pressure is now real — flag at next /erdnote: this is a [HYP] candidate for "audit response routinely 2× original code estimate."

## §8 Files touched

- `src/components/NewInquiryWizard.jsx` (sole code change)

## §9 Open questions

Resolved in Plan Revision Pass 1:

- ~~`is_primary: false` vs leave field unset~~ → resolved: existing-customer mode uses `false`, new-customer mode uses `true`. Locked at §2.4 / §2.5.
- ~~Should §2 also set `is_billing_contact: true`?~~ → resolved by audit: YES, both columns set in both branches. Closes §6 item 1 from round 0.

New (none blocking — all resolved by audit recommendations):

(No items requiring blocking input from Chris.)

## §10 Plan Revision Pass 1 — change log

Round-1 audit response. Each item below maps an audit finding (or finding cluster) to the section that closed it.

### Closed in this revision

| Audit ID(s) | Finding (short) | Closed in | Mechanism |
|---|---|---|---|
| A2 | Cross-tenant write surface via injectable `customerId` | §2.1 | Ownership preflight against `customers` (RLS hard-stop) |
| K1, D2, F1 (stale-row footnote) | Duplicate Billing Contact on race / stale state | §2.4 | Preflight SELECT + skip-on-existing |
| (silent INSERT) | `.insert()` returns success when RLS filters to zero rows | §2.4, §2.5 | `.select("id")` + `bcRow.length === 0` failure check |
| (UPDATE silent fail) | Existing-customer UPDATE error ignored; wizard proceeds to call_log INSERT regardless | §2.2 | `cuErr` check + halt |
| (alert UX) | `alert()` popup on money-bearing write surface | §2.6 | `setError` + halt mirrors file convention at `:341` |
| E1 | Empty-string vs NULL drift on `customers.billing_*` | §2.3 | `|| null` normalize on both branches |
| (symmetry) | Wizard inserts set `role` only; ContactModal sets both | §2.4, §2.5 | Both columns set on both wizard branches |
| D1 | additionalContacts dedup misses name-mismatch case | §3 | Drop ALL `role='Billing Contact'` rows when wizard will write |
| (additionalContacts silent fail) | additionalContacts INSERT error swallowed by alert | §3 | `setError` + halt; `is_billing_contact` derived from role |

### Re-scoped / clarified

- **§2.7 scope honesty** — original §2 implied the existing-customer fix fires whenever user types billing values. Picker lock state machine means it only fires when no Billing Contact on file (manual mode reachable). Picker unlock affordance filed as §6 item 7.

### Filed as §6 follow-ups (not fixed in this loop)

| Audit ID | Item | §6 row |
|---|---|---|
| A1 | Tenant-mismatch trigger on `customer_contacts` | 1 |
| A2 amplifier | `send-invoice`/`send-pay-app` tenant filter on contact reads | 2 |
| (race) | DB-level uniqueness on Billing Contact per customer | 3 |
| H1 | ContactModal mirror to `customers.billing_*` | 4 |
| G1 | `CallLogDetail.jsx:121` role-only filter → OR-pattern | 5 |
| G2 | Extract `pickBillingContact` to shared lib | 6 |
| (UX) | Picker unlock affordance | 7 |
| F1 (blocker) | `billing_same` semantics: refuse/delete/deprecate | 8 |
| — | additionalContacts general dedup | 9 |
| — | Picker hint copy | 10 |
| M2 | `updated_at` + audit log on `customer_contacts` | 11 |

### Round-1 manifest values for next round detection

- Plan revision under audit (round 0): `be239b2`
- Findings closed in PRP1: 10 (across audit IDs A2, D1, D2, E1, F1-footnote, K1, plus 3 cross-cutting: silent-INSERT, UPDATE-silent-fail, cross-surface symmetry)
- Findings filed: 11 (A1, A2-amplifier, race-uniqueness, H1, G1, G2, picker-unlock, F1-blocker, dedup, hint-copy, M2)
- Pattern: cross-surface-asymmetry + tenant-trust-boundary + silent-failure

### What did NOT change

- §1 Root cause is unchanged — the audit confirmed the diagnosis. The fix needed to be wider than originally specified, but the diagnosis was correct.
- §8 Files touched is unchanged — all revisions remain in `src/components/NewInquiryWizard.jsx`.
- §4 verification kept its original three Checks A/B/C; §4.4 adds five defensive smoke cases for the new audit-driven code paths.

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

