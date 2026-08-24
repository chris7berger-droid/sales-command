# Lock-at-Sold — Deploy Runbook

**Repo:** sales-command · **Branch:** `feat/lock-at-sold` · **Plan:** `docs/plans/lock_at_sold_enforcement.md`
**Written:** 2026-08-24 (build session, for the deploy session — build terminal doesn't deploy)

This is the whole ship, in order. It's short: a click-through test, then one script run
twice, then merge. **Do not reorder** — the cleanup MUST finish before the code goes live
(see "Why the order" at the bottom).

---

## The order (do not skip, do not reorder)

```
A. Smoke on preview   →   B. Clean up old jobs   →   C. Confirm 0 left   →   D. Merge
```

Merging is what makes it live (Vercel auto-deploys `main` to prod). So D is genuinely last.

---

## A. Smoke test (preview site)

Preview auto-deployed when the branch was pushed — grab its URL from the Vercel dashboard
(sales-command project → the `feat/lock-at-sold` deployment).

Make one **test job** (put "test" in the job name — that skips the QuickBooks side effects)
and click through the 8 checks in plan §7 (plain-English version below). Each should behave
as noted:

1. **Sold job → try to unlock a work type.** Blocked, told to pull it back first. Same from inside the calculator.
2. **A "Sent" job → open a work type.** Prices are read-only. Close it — nothing you didn't touch got saved.
3. **Same Sent job → Scope of Work tab.** Still editable. Change the crew scope, save, reload — scope stuck, prices didn't move. Try the customer-facing scope too.
4. **Draft job that already has a billing schedule → unlock.** Warns you the schedule is at $X and to update it. Yes → unlocks. Re-lock → schedule does NOT change on its own.
5. **Approve a job with one work type still unlocked.** Blocked, names it. Lock it → approve works → QuickBooks job + rep notice still fire.
6. **A multi-GC copy.** Its work types arrive unlocked (expected). Approve blocked → lock them → approve goes through.
7. **Sold job → the "add work type" button is gone.** On a Draft it's there. An archive job approves like always.
8. **Send / Pull Back / Send to Schedule → all behave exactly like before.** After a pull-back, everything's editable again.

Clean? Move to B.

---

## B. Clean up the old sold-but-unlocked jobs (the backfill)

Run from the repo root, on the branch. Set the four values first.

```bash
cd ~/sales-command
git checkout feat/lock-at-sold && git pull

export SUPABASE_URL="https://pbgvgjjuhnpsumnowuym.supabase.co"
export SUPABASE_ANON_KEY="<VITE_SUPABASE_ANON_KEY from .env or Vercel>"
export BACKFILL_ADMIN_EMAIL="<your app login — must be an Admin/Manager user>"
export BACKFILL_ADMIN_PASSWORD="<your app login password>"
```

**B1 — dry run (writes nothing):**
```bash
node scripts/backfill_relock_committed_wtcs.mjs
```
It prints each job it will touch (Sent / Signed / Sold counts) and the price it computes
per work type, and saves a snapshot for the safety check. **Read the list.** The count
should be around 22. If a number looks wrong, stop and ask — don't apply.

**B2 — apply (writes for real), back-to-back with the dry run:**
```bash
node scripts/backfill_relock_committed_wtcs.mjs --apply
```
It re-checks that nothing changed since the dry run, then re-locks the old jobs. If it
aborts saying something moved, just re-run B1 then B2. It ends by telling you to run the
count check (C).

---

## C. Confirm zero left

Run this in the Supabase SQL editor. It must return **0**.

```sql
SELECT count(*) AS unlocked_committed
FROM proposal_wtc w
JOIN proposals p ON p.id = w.proposal_id
WHERE w.locked = false
  AND p.status IN ('Sent','Signed','Sold')
  AND p.deleted_at IS NULL
  AND p.is_archive_proposal IS NOT TRUE;
```

- **0** → safe to go live. Continue to D.
- **Not 0** → do NOT merge. The apply didn't finish; re-run B, then re-check.

---

## D. Merge (this makes it live)

```bash
git checkout main && git pull
git merge feat/lock-at-sold
git push
```

Vercel deploys `main` to prod automatically. Watch the deploy go green, then do a 30-second
sanity click on the real site: open one Sold job, confirm the unlock is blocked.

Done.

---

## Why the order (the one thing that matters)

There are ~22 old jobs sitting **sold/sent but unlocked** right now. The new code closes
every way to *create* that state, but a customer signing one of those existing jobs can
still slip through the one door left open (the signing page). Step B re-locks them so that
door has nothing to walk through. **If the code went live before B, there'd be a window
where an old job could recreate the exact bug this fixes.** That's the whole reason B comes
before D.

(The signing-page door itself is deliberately left for a later DB-level fix — plan §6. This
ship closes it by making the population empty, not by gating the door.)
