# T&M Tickets — SUPERSEDED

This plan went through two designs and two audit rounds. Both are superseded.

**Current plan:** [`tm_billing.md`](./tm_billing.md) — T&M Billing, Day Rows on the Invoice.

- **v1** — T&M ticket as its own object (3 tables, 12 RLS policies, its own routes). Round 1: 23 caused-by, 1C/5H/15M/4L, pattern `rate-card-exclusion-overreach`. Model replaced.
- **v2** — the invoice line *is* the ticket. Round 2: 14 caused-by, 0C/7H/7M — **−39%, Critical dissolved**. Model validated; the remaining concentration was the rate-card exclusion and its migration.
- **v3** — `tm_billing.md`: the billing half only. The rate-card exclusion split to backlog **F44**.

Full text of v1 and v2 is in git history on `feat/tm-tickets` (`fe95d49` → `6356abd`).
