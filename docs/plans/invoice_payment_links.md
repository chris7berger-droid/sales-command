# Invoice Payment Links — Replace Checkout Sessions

**Status:** In progress (Loop #23, 2026-05-21)
**Branch:** `fix/invoice-payment-links`
**Backlog row:** B33
**Trigger:** Customer hit Stripe pay link for invoice #10028 and got "You're all done here. You've either completed your payment or this checkout session has timed out." → diagnosed as default 24h expiry on Stripe Checkout Sessions (hard cap, cannot be raised).

## Success criterion (Chris, ERD lock 12:49)

> Customer invoices links last until they pay or we cancel their link when the invoice status is updated to paid.

## Why Payment Links (not Checkout Sessions)

| API | Lifetime | Our use |
|---|---|---|
| `POST /v1/checkout/sessions` (today) | 24h hard cap (Stripe-enforced) | Current — broken when customer waits >24h |
| `POST /v1/payment_links` (proposed) | Live until `active=false` | Matches success criterion |

**Confirmed (Stripe docs):**
- Payment Links accept inline `line_items[0][price_data]` — same shape we use today. No pre-created Price object required. One API call per invoice.
- Webhook event remains `checkout.session.completed`. The Payment Link spawns a Checkout Session on click; metadata on the Payment Link propagates to the spawned Session automatically.
- Deactivation: `POST /v1/payment_links/{id}` with `active=false`. URL becomes immediately invalid; visitors see "this link has been deactivated" (or optional custom `inactive_message`).

## Data model change

Add one nullable column:

```sql
ALTER TABLE invoices ADD COLUMN stripe_payment_link_id TEXT;
COMMENT ON COLUMN invoices.stripe_payment_link_id IS 'Stripe Payment Link ID (plink_*). Used to deactivate the link on paid/void/pull-back. Null for legacy invoices (Checkout Session era).';
```

- `stripe_checkout_url` keeps its name — now holds the `buy.stripe.com/<token>` URL instead of `checkout.stripe.com/c/pay/cs_live_...`.
- `stripe_checkout_id` keeps its name — webhook still writes the Session ID on payment (unchanged semantic).
- `stripe_payment_link_id` is the new column for the `plink_*` ID, used for deactivation lookups.

Backfill: none. Legacy invoices keep their (already-broken) Checkout Session URL; resending through the UI mints a fresh Payment Link.

## Code changes

### 1. `supabase/functions/send-invoice/index.ts` (lines 121–155)

Swap the Stripe API call:

```diff
- const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
+ const stripeRes = await fetch("https://api.stripe.com/v1/payment_links", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
-     "mode": "payment",
-     "customer_email": customerEmail,
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][product_data][name]": `${customerName} - Invoice #${invoiceId}`,
      "line_items[0][price_data][product_data][description]": `${jobId ? `Job #${jobId}` : ""}${jobId && jobName ? ` - ${jobName}` : jobName || ""} · High Desert Surface Prep`,
-     "payment_intent_data[description]": `${customerName} - Invoice #${invoiceId}${jobId ? ` · Job #${jobId}` : ""}${jobName ? ` - ${jobName}` : ""}`,
      "line_items[0][price_data][unit_amount]": String(Math.round(amount * 100)),
      "line_items[0][quantity]": "1",
-     "success_url": `${SITE_URL}/invoice-paid?session_id={CHECKOUT_SESSION_ID}&invoice_id=${invoiceId}`,
-     "cancel_url": `${SITE_URL}`,
+     "after_completion[type]": "redirect",
+     "after_completion[redirect][url]": `${SITE_URL}/invoice-paid?invoice_id=${invoiceId}`,
      "metadata[invoice_id]": invoiceId,
-     "payment_intent_data[metadata][invoice_id]": invoiceId,
+     "payment_intent_data[metadata][invoice_id]": invoiceId,
    }).toString(),
  });
```

Why each delta:
- `mode=payment` — not a Payment Link param (Payment Links are payment-only by default).
- `customer_email` — not supported on Payment Links (customer enters at checkout).
- `payment_intent_data[description]` — supported on Payment Links, keep.
- `success_url` / `cancel_url` → `after_completion[type]=redirect` + `after_completion[redirect][url]`. Cancel URL has no equivalent (Payment Links don't have a cancel concept — customer just closes the tab).
- `metadata[invoice_id]` — Payment Links support metadata; propagates to spawned Sessions.
- `payment_intent_data[metadata][invoice_id]` — still useful for the PaymentIntent layer (QB sync reads from the Session's metadata, but defense in depth).

Then store both IDs:

```diff
  const checkoutUrl = stripeData.url;
- const checkoutId = stripeData.id;
+ const paymentLinkId = stripeData.id; // plink_*

- await supabase.from("invoices").update({ stripe_checkout_url: checkoutUrl }).eq("id", invoiceId);
+ await supabase.from("invoices").update({
+   stripe_checkout_url: checkoutUrl,
+   stripe_payment_link_id: paymentLinkId,
+ }).eq("id", invoiceId);

  // ...
- return new Response(JSON.stringify({ success: true, checkoutId, checkoutUrl }), { ... });
+ return new Response(JSON.stringify({ success: true, paymentLinkId, checkoutUrl }), { ... });
```

### 2. `src/pages/Invoices.jsx` — caller-side write (line 1595)

Current:
```js
const updates = { status: "Sent", sent_at: ..., viewing_token_expires_at: ..., stripe_checkout_id: responseData?.checkoutId || null, stripe_checkout_url: responseData?.checkoutUrl || null };
```

Update to write `stripe_payment_link_id` instead of `stripe_checkout_id`. **But:** keep `stripe_checkout_id` field write as null so we don't have a stale Checkout Session ID from a previous resend cycle.

```js
const updates = {
  status: "Sent",
  sent_at: ...,
  viewing_token_expires_at: ...,
  stripe_checkout_id: null,
  stripe_checkout_url: responseData?.checkoutUrl || null,
  stripe_payment_link_id: responseData?.paymentLinkId || null,
};
```

### 3. `supabase/functions/stripe-webhook/index.ts` (lines 89–121)

Add deactivation step after the status flip. Reads `session.payment_link` (Stripe-provided field), calls deactivation, then proceeds. Non-fatal — failure to deactivate is logged but doesn't block status flip.

```diff
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const invoiceId = session.metadata?.invoice_id;
    const paymentIntent = session.payment_intent;
+   const paymentLinkId = session.payment_link; // null for non-PaymentLink-originated sessions
    // ...
    const { error } = await supabase.from("invoices").update({
      status: "Paid",
      stripe_checkout_id: session.id,
      stripe_payment_id: paymentIntent,
      paid_at: new Date().toISOString(),
    }).eq("id", invoiceId);
    // ...
+
+   // Deactivate the Payment Link so the URL stops accepting payments.
+   // Non-fatal — payment is already recorded; this prevents future double-pays.
+   if (paymentLinkId && STRIPE_SECRET_KEY) {
+     try {
+       const deactRes = await fetch(`https://api.stripe.com/v1/payment_links/${paymentLinkId}`, {
+         method: "POST",
+         headers: {
+           "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
+           "Content-Type": "application/x-www-form-urlencoded",
+         },
+         body: new URLSearchParams({
+           "active": "false",
+           "inactive_message": `This invoice has been paid. Thank you!`,
+         }).toString(),
+       });
+       console.log("Deactivate payment link", paymentLinkId, ":", deactRes.status);
+     } catch (e) {
+       console.error("Payment link deactivation failed (non-fatal):", e.message);
+     }
+   }
  }
```

### 4. `src/pages/Invoices.jsx` — void/pull-back paths (lines 1250, 1287)

Both paths currently null `stripe_checkout_url, stripe_checkout_id, stripe_payment_id`. We add: read `stripe_payment_link_id` first, call deactivation via a small new edge fn, then null it.

**Decision: new edge fn `deactivate-payment-link`** (rather than client-side direct Stripe call) — client doesn't have STRIPE_SECRET_KEY and shouldn't. Edge fn pattern:
- Accepts `{ paymentLinkId }`.
- Service-role authenticated (no caller auth needed since we're about to authenticate the caller for the void/pullback action itself — but mirror C9 tenant binding for safety).
- POST to Stripe with `active=false`.
- Returns `{ success: true }` or 500.

Update both `handlePullBack` and `handleVoidConfirm`:

```js
// before nulling
if (inv.stripe_payment_link_id) {
  try {
    await supabase.functions.invoke("deactivate-payment-link", {
      body: { paymentLinkId: inv.stripe_payment_link_id, invoiceId: inv.id },
    });
  } catch (e) {
    console.warn("Payment link deactivation failed (non-blocking):", e);
    // continue with the null write — link cleanup will be best-effort
  }
}
// then update the row, also null stripe_payment_link_id
const updates = { ..., stripe_payment_link_id: null };
```

### 5. New edge fn `supabase/functions/deactivate-payment-link/index.ts`

Minimal. Authenticates caller (`authenticateCaller`), confirms invoice belongs to caller's tenant (binds the payment link to the invoice for tenant scoping), POSTs to Stripe, returns success.

## Migration

`supabase/migrations/<next-ts>_invoices_stripe_payment_link_id.sql`:

```sql
ALTER TABLE invoices ADD COLUMN stripe_payment_link_id TEXT;
COMMENT ON COLUMN invoices.stripe_payment_link_id IS 'Stripe Payment Link ID (plink_*). Used to deactivate the link on paid/void/pull-back. Null for legacy invoices (Checkout Session era).';
```

Run via `npm run db:push` (wrapper checks collision against prod ledger).

## Smoke plan (before merge)

1. Deploy edge fns to a Supabase project that mirrors prod schema (or use prod after migration is in — coordinate timing).
2. From preview deploy: send a test invoice to `chris7berger@gmail.com`.
3. Confirm email received, link URL is `buy.stripe.com/...`.
4. Wait 25+ hours (this is the actual point — link must survive past Checkout Session's 24h cap).
5. Click link, pay with Stripe test card `4242 4242 4242 4242` exp `12/30` cvc `123`.
6. Verify in Supabase: `invoices.status='Paid'`, `paid_at`, `stripe_payment_id` set.
7. Re-click the original link → should show "this link has been deactivated" (or our `inactive_message`).
8. Repeat for void path: send a test invoice, void it, confirm Payment Link is deactivated.
9. Repeat for pull-back path: send a test invoice with no QB sync (TEST customer), pull back, confirm deactivation.

## Risk register

| Risk | Mitigation |
|---|---|
| Webhook handler change breaks payment-status flips | Deactivation step is non-fatal; status update happens first. If deactivation fails, payment is still recorded. |
| Voiding an invoice without QB sync still goes through Stripe deactivation | Wrapped in try/catch in caller; non-blocking. Stripe failure doesn't prevent the void from completing locally. |
| Stripe API rate limits during burst sends | Payment Links and deactivations are independent. Volume is well below Stripe's limits. |
| Migration timing — column doesn't exist when edge fn writes to it | Migration goes first, edge fn deploy second. Standard sequencing per `feedback_run_migration_safety_first`. |
| QB sync still relies on `metadata.invoice_id` from session | Verified — Payment Links propagate metadata to spawned Session. No QB integration change needed. |

## Audit terminal checklist

For the parallel audit Claude session reviewing this build:

- [ ] Branch is `fix/invoice-payment-links`, off latest `main`. No work on `main`.
- [ ] Migration file present, follows `scripts/check-migration-safety.sh` pattern. Ledger collision checked.
- [ ] `send-invoice` calls `/v1/payment_links` (not `/v1/checkout/sessions`).
- [ ] `send-invoice` writes both `stripe_checkout_url` and `stripe_payment_link_id`.
- [ ] `stripe-webhook` reads `session.payment_link` and POSTs deactivation.
- [ ] `stripe-webhook` deactivation is wrapped in try/catch — payment status flip happens first.
- [ ] `Invoices.jsx` `handlePullBack` and `handleVoidConfirm` call `deactivate-payment-link` before nulling.
- [ ] New edge fn `deactivate-payment-link` authenticates caller and binds to tenant.
- [ ] Smoke test executed on preview deploy, not directly on prod.
- [ ] BACKLOG.md row B33 filed and updated on commit close.
- [ ] Handoff doc written before session ends.

## Out of scope (file follow-ups, do not expand here)

- Retroactive re-mint of currently-Sent unpaid invoices that have stale Checkout Session URLs (~F31 if needed)
- Surfacing `inactive_message` UX customization in tenant settings
- Refactor `send-invoice` response shape to be consistent across send-invoice / send-pay-app (different concern)
