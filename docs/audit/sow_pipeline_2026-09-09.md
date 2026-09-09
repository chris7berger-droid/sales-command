# Field SOW pipeline — investigation and resume point

**Date:** 2026-09-09. **Backlog:** SOW-1. **Status:** investigation complete; repairs NOT implemented or authorized. Proposed direction below is not an approved build plan.

## Chris's goal and authorization

Enter Field SOW in a Sales WTC; retain it with the proposal; carry it into the
job when sent to Schedule; make it available in Crew Schedule and on crews'
Field Command phones. Chris requested a read-only investigation, then asked
how to resolve the gaps. He subsequently authorized saving this investigation
to GitHub. Documentation writes only; no authorization for SOW implementation,
migrations, data cleanup, messages, or production mutations.

## Scope and baseline

GitHub heads verified during the investigation:
- sales-command production: `db7fa2d314124fe54f38f49c8264829ca407db76` (PR42).
- field-command: `eaf70ef363571678aad57d7234fca62b15e8131f` (handoff v12).
- command-suite-db: `935e89483c9fbf4096c4e278f5075ab7a34fa6c9`.

The local Sales checkout included weekly-text polish `76c0044`, which did not
change SOW logic. That unrelated work subsequently merged as PR43 / `2416c91`;
release closeout `5846719`, handoff v246. Its branch was removed. Do not reopen it.

## Existing plans: read these, do not start a competing architecture

- [Cross-repo master schedule](https://github.com/chris7berger-droid/command-suite-db/blob/main/docs/MASTER_SCHEDULE.md).
- [Shared-data contract](https://github.com/chris7berger-droid/sch-command/blob/main/docs/plans/command_suite_shared_data_contract.md), especially the contracted SOW row.
- [Daily material schedule plan](https://github.com/chris7berger-droid/sch-command/blob/main/docs/plans/daily_material_schedule.md), especially ReportTab migration/legacy retirement prerequisites.
- [Original material-flow design](../plans/material_flow.md).
- [Sales Screen 1 plan](../plans/material_flow_screen1_sales.md).
- [Field backlog](https://github.com/chris7berger-droid/field-command/blob/main/docs/BACKLOG.md): D1/D2 prior sync verification, B2 shared-crew rollup, FE1 trade labels.

These documents contain stale or internally conflicting status notes. For
example, the master schedule calls phone spec cards mockup-only, but current
TasksTab renders them. Treat code and verified deployment evidence as stronger
than old prose. This report supplements the plans; it does not supersede their
ratified decisions or authorize their deferred work.

## What is connected

| Step | Current implementation |
|---|---|
| WTC authoring | `src/pages/WTCCalculator.jsx`: SowTab authors day tasks, instructions, materials/specs, crew/hours; handleSave writes `proposal_wtc.field_sow`. |
| Proposal | The WTC remains linked by proposal_id. ProposalDetail.openSendReview fetches fresh WTCs and mobilizations. Customer PDF/signing display `sales_sow`, not internal `field_sow`. |
| Send | ProposalDetail.commitSendToSchedule writes canonical per-WTC `job_wtcs.field_sow` and a flat legacy `jobs.field_sow`. `jobs.sow` receives combined SALES SOW text. Mobilization UUID becomes day `mobilization_seq`; content is retained, dates are cleared. Trip dates copy separately into `job_mobilizations`. WTC write failure/short-write invokes rollback; trip seed failure warns but is nonfatal. |
| Schedule Jobs | StageJobCard SOW control opens CardSowModal / FieldSowBuilder. WTC saves use updateJobWtcFieldSow; legacy zero-WTC saves use jobs.field_sow. |
| Phone Field SOW | TasksTab reads job_wtcs through PowerSync, resolves job through call_log_id, groups days by date. Keeps tasks, instructions and material specs. Falls back to jobs.field_sow when no WTC rows exist. |

Contract already says: Sales authors before Send; Send creates a snapshot;
Schedule owns the live job SOW afterward; Field reads it. Preserve historical
proposal content rather than blindly backflowing Schedule revisions.

## Confirmed gaps

### 1. Crew Schedule's Scope / SOW is a different field

`src/schedule/components/ScheduleTripDetails.jsx` edits `job_mobilizations.sow`;
job defaults use `jobs.sow`. TripsPanel shows the same text. Neither is the
structured `job_wtcs.field_sow` the phone reads. A trip instruction edit does
not update phone tasks/instructions. Weekly texts are a separate clipboard
snapshot feature, not the native phone sync mechanism.

### 2. Trip dates and structured day dates are disconnected

PR42's send handler now explicitly stamps every copied SOW day `date:null`
and leaves job/WTC date spans null, while retaining mobilization dates. This
was deliberate removal of bidding-date authority, not loss of task content.
`updateJobMobilization` saves trip dates without updating job_wtcs day dates or
parent scheduled_start/end. A staffed, dated board trip can therefore retain
TBD days on the phone. The structured SOW editor can date days separately;
`updateJobWtcFieldSow` then derives WTC spans and parent scheduled spans.

`src/field/lib/queries.js` still filters out null parent scheduled_start and
windows by parent spans. Today/Jobs/Load-Outs can omit trip-only scheduled jobs.

### 3. Phone reporting reads an older/different SOW

`field-command/src/screens/tabs/ReportTab.js:34-48` reads jobs.field_sow first,
then `SELECT * FROM proposal_wtc WHERE field_sow IS NOT NULL LIMIT 10`, using
its first result without scoping to the job. It does not read job_wtcs.
Schedule canonical edits do not update the legacy mirror for WTC-backed jobs,
so Field SOW and PRT task lists can disagree. The fallback can select another
job's WTC. This older unfinished migration is explicitly documented in the
Daily Material Schedule plan; not caused by last night's web changes.

### 4. Post-send WTC edits can save a disconnected proposal copy

WTCCalculator.saveSowOnly permits SOW saves for Sent/Signed/Sold proposals but
writes only proposal_wtc. It does not update the live job. Schedule revision
badges exist on ProposalDetail, but this Sales save remains a separate path.
The contract's frozen-proposal language and this editable UI need reconciliation.

### 5. Phone has not adopted the current trip/assignment model

`field-command/powersync-sync-rules.yaml` and `src/lib/schema.js` carry job_wtcs
but not job_mobilizations or assignments. Schedule writes dated crew entries
to assignments; Field web reads job_crew. No bridge writer was found in current
Schedule code or the checked database baseline triggers. Phone Home/JobList
query call_log by active stage rather than the signed-in person's assignments.
A personalized, trip-specific daily phone view is not implemented.

TasksTab merges same-date trades into one day, takes the lowest mobilization
seq and labels it WTC; it does not render the available per-task trade tag.
B2/FE1 already track related rollup/label gaps. Do not duplicate those items.

### 6. Phone job lookup can select a deleted predecessor

TasksTab's subquery `SELECT id FROM jobs WHERE call_log_id = ?` has no live-row
filter or deterministic resolution for multiple records. An in-memory SQLite
fixture using the actual query selected a deleted predecessor and missed the
replacement job's WTC SOW. ReportTab's LIMIT 1 lookup has the related ambiguity.
Any repair must consider legitimate multiple job records as well as tombstones;
do not assume call_log_id is globally unique in jobs.

### 7. Per-trip SOW version schema exists without current app integration

Database migration `20260908120000_mobilizations_mob_type_note_scope_versions.sql`
adds job_mobilization_sow_versions and current_version_id. No readers/writers
were found in current Sales or Field src. Schema existence does not establish
a functioning trip-SOW pipeline. Inspect branches/design before adopting it.

## Verification performed (read-only)

- Verified GitHub heads via gh api; read current source, baseline/migrations,
  shared plans and Field handoffs/backlog.
- Ran existing `node scripts/check-send-schedule-dates.mjs`: PASS. Executes the
  real send handler against an in-memory boundary; confirms content retention,
  cleared day dates, retained trip dates and unchanged proposal input.
- Executed actual extracted phone merge functions in memory: tasks, instructions
  and material specs survive; undated days render TBD; same-date entries merge.
- Executed actual extracted updateJobMobilization and saveSowOnly functions with
  in-memory boundaries: confirmed independent table writes described above.
- Checked Field web date predicate with null parent dates: excluded.
- Ran actual phone WTC SQL against in-memory SQLite with a deleted predecessor
  and live replacement: canonical live SOW missed.
- All three repository working trees remained clean. No test files were saved.

**Limits:** production read query could not authenticate (Supabase CLI access
token unavailable). No live row comparison, current dashboard sync-rule check,
native build or current device delivery test. Prior Field D1 documented canonical
multi-WTC sync on simulator; handoff v12 documented an August 27 install on
Chris's iPhone. Neither proves today's crews have a current healthy installation.
No claim of a full end-to-end live pass.

## Proposed repair sequence — recommendation, not approved implementation

1. Unify operational readers on job_wtcs.field_sow, including PRT; remove the
   unrelated-proposal fallback. Retain intentional zero-WTC legacy support.
2. Define explicit trip membership for work-plan days/tasks with stable identity.
   Crew board shows that structured work; supplemental trip notes stay distinct.
   Return trips assign unfinished work or additional work without rewriting the
   sold proposal. Resolve split/repeated-task identity before choosing schema.
3. Map work-plan days to calendar dates explicitly. A date range alone cannot
   tell us when each task occurs. Moving a trip should offer to move its dated
   work too. Board, Field web and phones use the same calendar mapping.
4. Sync trips and dated crew assignments to phones, resolving scheduler crew
   names to actual employee identity; provide assigned work with offline support.
5. Make post-send Sales UI distinguish historical proposal SOW from live work;
   provide an Edit live Field SOW route, revision history and freshness cues.
6. Repair live/deleted/combined job resolution and inspect existing data for
   conflicts. No automatic bulk overwrites or date clearing without provenance.

Do not immediately migrate all scope into the new version table. First settle
trip/task references and revision semantics; avoid another competing copy.
Suggested delivery: first canonical reader/report fixes, then trip/calendar/
assignment-to-phone integration. Exact scope/schema decisions still need a plan.

## Acceptance scenario for eventual release

One job, two WTCs, multiple trips, different crews, a return trip, a date change
and an instruction revision. Verify WTC entry -> proposal retained -> Send ->
job SOW -> correct trip/day -> correct person's phone -> matching report tasks.
Verify materials/specs, stable task identity, trade labels and agreed crew/hour
rollups. Repeat offline/reconnect; cover old zero-WTC jobs and deleted/re-sent
jobs. Confirm historical proposal content stays intact and no other crew/job's
scope leaks into a report. Use fixtures first; live mutation smoke needs explicit
authorization and a bounded test job.

## Resume instruction

Read this report and SOW-1 in BACKLOG; refresh the three GitHub heads, then check
what changed since these anchors. Revalidate relevant findings instead of assuming
the dated investigation is current. Ask Chris which repair phase to authorize;
**do not resume implementation automatically from this document.**
