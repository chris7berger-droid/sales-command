# FIELD COMMAND DESKTOP — APPROVED IMPLEMENTATION HANDOFF

**Status:** APPROVED FOR BUILD — NOT YET AUTHORIZED TO MERGE
**Type:** Existing UI + Live Data Repair
**Date:** 2026-09-15
**Primary application:** chris7berger-droid/subcon-command
**Existing implementation:** GitHub PR #58 / branch cursor/field-office-restyle-3e1e

---

# 1. OBJECTIVE

Finish the desktop Field Command implementation so that it is both:

1. visually consistent with the approved Field Command command-board design, and
2. actually useful because the boards display the correct existing live application data.

The current visual work in PR #58 is useful and should be preserved where approved.

However, the implementation is NOT considered complete merely because the Field Command screens render.

The desktop Field Command must display the real records that already exist in the application.

The intended user outcome is:

A sales/office user opens Field Command and sees useful, current operational information from the existing system rather than empty boards, disconnected screens, fake data, or data omitted because the Field read logic is using the wrong date/source.

---

# 2. PRODUCT CONTEXT

Field Command is part of the DESKTOP web office shell.

It is not the phone app.

The desktop Field Command lives under:

`/field/*`

Field Command is intended to give office/sales users visibility into field operations using data that already exists in the system.

The application already contains real operational data and existing Supabase/data-access architecture.

This handoff does NOT authorize creating a parallel Field database, mock-data system, duplicate source of truth, or separate backend architecture.

Cursor must inspect the existing repository and determine the correct implementation from the application's established data model.

---

# 3. EXISTING FIELD COMMAND WORK

There is an existing unmerged implementation:

GitHub PR #58
Branch:
`cursor/field-office-restyle-3e1e`

Title:
`Restyle Field office lists as command boards`

The useful visual implementation includes command-board treatments for:

- Jobs
- Crews
- Daily Logs
- Load-Outs
- Time Clock
- Today

It also includes shared Field UI/chrome such as:

- FieldScreen
- StatStrip
- FilterChips
- StatusChip
- ErrorNote
- EmptyNote
- command-board/table styling
- espresso/dark header treatment
- teal status/chip treatment
- sand/linen surfaces
- Barlow typography direction

Do not throw away this work and rebuild Field Command from scratch unless repository investigation proves that a specific implementation must be replaced.

Preserve the approved visual direction while repairing the underlying behavior.

PR #58 is NOT approved for merge in its current state.

---

# 4. PRIMARY PROBLEM TO SOLVE

The current Field Command implementation does not display the real operational data as expected.

Do NOT assume that "the query exists" means this requirement is satisfied.

The task is to determine why the rendered Field Command boards are empty, incomplete, or inconsistent with the real data already present elsewhere in the application.

Then fix the READ path so Field Command presents the correct existing data.

This is primarily a data-reading/display problem.

Do not alter authoritative production write behavior merely to make Field Command populate.

---

# 5. IMPORTANT EXISTING INVESTIGATION

A previous read-only investigation found a likely data-authority mismatch around Field Jobs.

It reported:

Field Jobs currently requires:

`jobs.scheduled_start`

However, trip dates are stored using:

`job_mobilizations.start_date`
`job_mobilizations.end_date`

The existing Schedule implementation already has logic equivalent to an effective job start using scheduled job dates with fallback behavior.

The previous investigation specifically recommended aligning the Field READ logic rather than writing trip dates into:

`jobs.scheduled_start`

This finding is a STARTING POINT, not an instruction to blindly implement a particular query.

Cursor must verify the current repository, schema usage, existing query helpers, historical decisions, and current data model before changing anything.

The important product requirement is:

Field Command should correctly interpret the application's existing authoritative data rather than requiring duplicate dates or artificial writes solely to make the Field boards work.

---

# 6. DATA INTEGRITY PRINCIPLE

Do not "fix" empty Field boards by copying existing data into a second field merely because the current Field query expects that field.

Prefer correcting Field's READ model to understand the authoritative existing data.

Before changing data behavior, inspect:

- existing Supabase query architecture
- jobs
- job_mobilizations
- scheduling helpers
- existing Schedule views
- existing Field queries
- relevant historical handoffs/documentation
- existing date-authority decisions
- relationships between jobs, crews, logs, load-outs, time clock, and mobilizations

Reuse existing proven helpers where appropriate.

Do not create competing definitions for concepts such as:

- job start
- job end
- active job
- scheduled job
- crew assignment
- mobilization/trip window

when the application already has authoritative definitions.

---

# 7. SCREENS TO VERIFY

Do not assume Jobs is the only affected screen.

Audit each existing desktop Field Command board:

## Jobs

Verify that expected real jobs appear.

Verify relevant states such as scheduled/live/in-progress/mobilized according to the application's established definitions.

Investigate date-window filtering carefully.

## Crews

Verify real crew assignments and relevant job relationships appear.

Do not substitute fabricated crew data.

## Daily Logs

Verify real existing field/daily log records populate where expected.

## Load-Outs

Verify real load-out/material-check information populates where expected.

## Time Clock

Verify the board uses the existing authoritative time-clock data path.

## Today

Verify the Today board correctly rolls up the intended real operational information.

For every screen, distinguish between:

- genuinely no records,
- query/filter bugs,
- incorrect relationship assumptions,
- date-authority problems,
- permissions/auth problems,
- and rendering/UI problems.

An empty result is not automatically proof that there is no data.

---

# 8. APPROVED VISUAL DIRECTION

Preserve the useful visual direction from PR #58.

Field Command should feel like an operational command surface, not a generic spreadsheet.

The established direction includes:

- clean modern command-board presentation
- dark/espresso command header
- teal accents/status communication
- sand/linen neutral surfaces
- strong information hierarchy
- readable status chips
- useful summary/stat information
- compact but readable operational tables/boards
- visual consistency with the established desktop Office/Sales/Schedule design language

Do not independently redesign the approved visual direction during the data repair.

If data wiring exposes a UI state that genuinely needs design treatment, implement it consistently with the existing Field visual system rather than redesigning the whole screen.

---

# 9. IN SCOPE

- Preserve and finish the desktop Field Command visual implementation.
- Investigate the existing PR #58 implementation.
- Audit the real data path for every Field Command board.
- Correct Field read/query/filter/relationship logic where required.
- Reuse existing authoritative application data and helpers.
- Ensure expected existing records appear.
- Fix UI behavior directly caused by real-data integration.
- Run relevant tests/checks.
- Run the actual application.
- Visually inspect every affected Field Command screen.
- Produce a Vercel preview for Chris to review after implementation.
- Update `docs/agent-handoffs/BUILD-REPORT.md`.

---

# 10. OUT OF SCOPE

Do NOT:

- redesign the phone application
- change phone Field/job-menu UI
- create a new Field database
- create mock production data
- create duplicate Supabase tables
- rewrite unrelated Schedule functionality
- change unrelated Sales functionality
- redesign unrelated Office screens
- add unrelated new Field features
- perform broad architectural refactors unrelated to fixing Field Command
- merge PR #58 as-is
- merge the completed work without Chris's explicit preview acceptance

---

# 11. DO NOT CHANGE WITHOUT A VERIFIED NEED

Preserve existing production behavior for:

- phone workflows
- job creation
- scheduling
- trip/mobilization writes
- existing Supabase write paths
- Sales
- Schedule
- unrelated Command Suite behavior

If correcting Field requires changing shared logic, first determine whether the shared change preserves existing behavior for current consumers.

Do not alter authoritative write semantics merely to satisfy an incorrect Field read assumption.

---

# 12. IMPLEMENTATION APPROACH

Before coding:

1. Start from current GitHub `main`, which contains the ChatGPT-to-Cursor workflow.
2. Inspect PR #58 and determine the safest way to preserve/reuse its approved Field visual work.
3. Inspect the existing Field implementation.
4. Inspect the existing data-access/query architecture.
5. Trace each Field board from rendered component to query to Supabase/source data.
6. Compare those assumptions with how the rest of the application reads the same concepts.
7. Identify why expected existing records are not appearing.
8. Form an implementation plan based on the repository.

Do not ask Chris to identify the necessary components, queries, tables, or implementation files when they can be discovered from the repository.

Once the problem is understood, implement the smallest coherent correction that satisfies the product requirement.

---

# 13. VERIFICATION REQUIREMENTS

Code completion is not sufficient.

After implementation:

1. Run relevant type/lint/build/test checks.
2. Run the application.
3. Navigate through every Field Command screen.
4. Verify the screens against actual existing data.
5. Confirm that records expected from the existing application appear where appropriate.
6. Verify that genuinely empty states remain honest empty states.
7. Check browser console/runtime errors.
8. Check adjacent desktop UI for obvious regressions.
9. Confirm phone behavior was not intentionally changed.
10. Visually compare the result with the approved Field Command direction.

For each Field screen, record in BUILD-REPORT.md:

- what data source/query it uses,
- what was wrong, if anything,
- what was changed,
- and how the populated result was verified.

Do not report "live data connected" solely because a Supabase function was called.

Verification must include the rendered result whenever the environment permits it.

---

# 14. ACCEPTANCE CRITERIA

The implementation is ready for Chris review when:

- [ ] Approved PR #58 visual direction has been preserved or correctly integrated.
- [ ] Field Jobs displays the expected existing jobs according to the application's authoritative scheduling/mobilization model.
- [ ] Crews displays expected existing crew/assignment information.
- [ ] Daily Logs displays expected existing log information.
- [ ] Load-Outs displays expected existing load-out information.
- [ ] Time Clock displays expected existing time-clock information.
- [ ] Today displays the intended real operational rollup.
- [ ] No production mock data was introduced.
- [ ] No duplicate data source was created to make Field work.
- [ ] Existing authoritative write behavior was preserved unless a verified defect required otherwise.
- [ ] Relevant automated checks pass, or pre-existing failures are clearly documented.
- [ ] Field Command has been run and visually inspected.
- [ ] BUILD-REPORT.md documents each board's data path and verification.
- [ ] A Ready Vercel preview is available for Chris.
- [ ] Nothing has been merged to main without Chris's explicit acceptance.

---

# 15. BUILD REPORT REQUIREMENT

Update:

`docs/agent-handoffs/BUILD-REPORT.md`

The report must include:

## Status

Complete / Partially Complete / Blocked

## Root Cause

Explain why Field Command was not displaying the expected real data.

Separate root causes by board if necessary.

## Data Paths Verified

For each:

- Jobs
- Crews
- Daily Logs
- Load-Outs
- Time Clock
- Today

Document the actual existing data path and relevant source/query/helper.

## Files Changed

List significant files and why.

## Implementation Decisions

Explain important technical decisions, especially around date authority and mobilizations.

## Verification

List tests/build/runtime checks performed and results.

## Visual Verification

State which Field screens were actually opened and inspected.

## Deviations From Handoff

If none:

`None.`

## Issues / Follow-up

Document anything intentionally deferred or requiring Chris's product decision.

---

# 16. MERGE GATE

Do not merge this application work to `main` merely because implementation and tests succeed.

The required sequence is:

Implement
→ test
→ run
→ visually verify
→ create Ready Vercel preview
→ present to Chris
→ Chris reviews actual result
→ corrections if necessary
→ Chris explicitly accepts
→ only then merge according to the project's session-wrap workflow.

An approved handoff authorizes implementation.

It does NOT constitute final merge approval.

---

# 17. FINAL PRODUCT INTENT

Field Command is supposed to be an operational window into what is actually happening in the field.

A beautiful empty command board is not a finished product.

The final result should preserve the approved visual quality while reliably showing the real operational information already present in the system.

When implementation details are ambiguous, optimize for accurate representation of the application's authoritative existing data, minimal duplication, preservation of established behavior, and usefulness to the office/sales user.
