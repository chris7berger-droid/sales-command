// Pure helper: turn jobs + their dated allocation blocks into weekend-aware,
// lane-packed spanning bar segments for the calendar grid.
//
// This is the novel piece of the calendar modernization (plan §2.1). It replaces
// the old per-cell "one bar per job per day" paint with CONTINUOUS bars that:
//   - span a maximal run of consecutive WORKED days (canonical Mon–Sat + assigned
//     weekend rule from lib/workdays.js — the SAME rule DaysModal/StageJobCard use),
//   - break before an unworked weekend and resume after it (a new bar Monday),
//   - run THROUGH a weekend that actually has crew assigned,
//   - render each allocation block as its own bar (go-backs stay separate — B87),
//   - split at week-row boundaries (a run crossing Sat→Sun becomes two segments),
//   - pack into stable lanes, capping at the row height and routing the surplus
//     to a per-date "+N more" overflow count.
//
// It reads nothing and mutates nothing — all inputs are already-loaded data.

import { jobOwnRange } from './allocations'
import { isWorkedDay, ymd } from './workdays'

function dstr(v) { return v ? String(v).split('T')[0] : '' }

// Alloc-preserving sibling of jobRanges(): every dated block for a job = its own
// first block (alloc=null) + each live job_mobilizations row (go-backs, B87).
// jobRanges() drops the alloc object; the bar label needs it (crew_needed/lead
// via pickAllocField), so this keeps it. A block with a start but no end (or vice
// versa) collapses to a single day, matching the month grid's long-standing
// behavior for open-ended blocks.
export function jobBlocks(job, allocsForJob) {
  const blocks = []
  const own = jobOwnRange(job)
  if (own) blocks.push({ start: own.start || own.end, end: own.end || own.start, alloc: null })
  const list = Array.isArray(allocsForJob)
    ? allocsForJob
    : (allocsForJob ? Object.values(allocsForJob) : [])
  for (const a of list) {
    if (!a) continue
    const s = dstr(a.start_date)
    const e = dstr(a.end_date)
    if (!s && !e) continue
    blocks.push({ start: s || e, end: e || s, alloc: a })
  }
  return blocks
}

// Iterate the inclusive [startYmd, endYmd] range as Date objects.
function eachDay(startYmd, endYmd, fn) {
  if (!startYmd || !endYmd) return
  const cur = new Date(startYmd + 'T00:00:00')
  const end = new Date(endYmd + 'T00:00:00')
  while (cur <= end) {
    fn(new Date(cur), ymd(cur))
    cur.setDate(cur.getDate() + 1)
  }
}

// For one job's blocks, decide which block "owns" each assigned weekend day, so a
// single assignments row (which has no block FK — finding G) is attributed to
// exactly one bar: the earliest block (by start date) whose range contains it.
function weekendOwners(blocks, assignedSet) {
  const owner = {}  // ymd -> index of owning block
  if (!assignedSet || assignedSet.size === 0) return owner
  const order = blocks
    .map((b, i) => ({ i, start: b.start || '9999-12-31' }))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.i - b.i))
  for (const ds of assignedSet) {
    const d = new Date(ds + 'T00:00:00')
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) continue  // only weekend days need attribution
    for (const { i } of order) {
      const b = blocks[i]
      if ((b.start && ds < b.start) || (b.end && ds > b.end)) continue
      owner[ds] = i
      break
    }
  }
  return owner
}

// Maximal runs of consecutive WORKED days within one block, applying the weekend
// rule + per-block weekend ownership. Returns [{ start, end }] (ymd strings).
function blockRuns(block, blockIndex, assignedSet, owner) {
  const runs = []
  let runStart = null
  let prev = null
  eachDay(block.start, block.end, (d, ds) => {
    const dow = d.getDay()
    const isWeekend = dow === 0 || dow === 6
    let worked
    if (!isWeekend) {
      worked = true
    } else {
      // Weekend counts only if assigned AND this block owns that day.
      worked = isWorkedDay(d, assignedSet) && owner[ds] === blockIndex
    }
    if (worked) {
      if (runStart === null) runStart = ds
      prev = ds
    } else if (runStart !== null) {
      runs.push({ start: runStart, end: prev })
      runStart = null
      prev = null
    }
  })
  if (runStart !== null) runs.push({ start: runStart, end: prev })
  return runs
}

// Build a ymd -> { row, col } lookup from the grid rows (each row = Date[]).
function cellIndex(rows) {
  const map = {}
  rows.forEach((week, r) => {
    week.forEach((d, c) => { map[ymd(d)] = { row: r, col: c } })
  })
  return map
}

// Split one worked-day run into per-row segments, clipped to the visible grid.
// A run's days are contiguous, so within any row they occupy contiguous columns.
function runSegments(run, cellMap) {
  const byRow = {}  // row -> { minCol, maxCol, startYmd, endYmd }
  eachDay(run.start, run.end, (d, ds) => {
    const cell = cellMap[ds]
    if (!cell) return  // day falls outside the visible grid — clip it
    const g = byRow[cell.row]
    if (!g) {
      byRow[cell.row] = { minCol: cell.col, maxCol: cell.col, startYmd: ds, endYmd: ds }
    } else {
      if (cell.col < g.minCol) { g.minCol = cell.col; g.startYmd = ds }
      if (cell.col > g.maxCol) { g.maxCol = cell.col; g.endYmd = ds }
    }
  })
  return Object.entries(byRow).map(([row, g]) => ({
    rowIndex: Number(row),
    startCol: g.minCol,
    endCol: g.maxCol,
    startYmd: g.startYmd,
    endYmd: g.endYmd,
  }))
}

// Comparator: start-date → job_num → seq (finding H). Deterministic so lanes are
// stable between renders.
function segmentSort(a, b) {
  if (a.startYmd !== b.startYmd) return a.startYmd < b.startYmd ? -1 : 1
  const an = String(a.job?.job_num || ''), bn = String(b.job?.job_num || '')
  if (an !== bn) return an.localeCompare(bn, undefined, { numeric: true })
  const as = a.alloc?.seq ?? -1, bs = b.alloc?.seq ?? -1
  return as - bs
}

// Main entry. Returns { segmentsByRow, overflowByYmd }.
//   segmentsByRow: Array (one per grid row) of positioned segments with a lane.
//   overflowByYmd: { ymd: count } for cells whose surplus segments were dropped.
export function buildCalendarBars({ rows, jobs, blocksByJobId, assignedDaysByJob, maxLanes = 4 }) {
  const cellMap = cellIndex(rows)

  // 1. Segment every block of every job.
  const segments = []
  for (const job of jobs) {
    const blocks = blocksByJobId[String(job.job_id)] || []
    if (!blocks.length) continue
    const assignedSet = assignedDaysByJob[String(job.job_id)] || null
    const owner = weekendOwners(blocks, assignedSet)
    blocks.forEach((block, bi) => {
      for (const run of blockRuns(block, bi, assignedSet, owner)) {
        for (const seg of runSegments(run, cellMap)) {
          segments.push({ ...seg, jobId: job.job_id, job, alloc: block.alloc })
        }
      }
    })
  }

  // 2. Lane-pack per row (greedy over the deterministic sort); cap → overflow.
  const segmentsByRow = rows.map(() => [])
  const overflowByYmd = {}
  const byRow = {}
  for (const seg of segments) (byRow[seg.rowIndex] ||= []).push(seg)

  for (const [rowStr, rowSegs] of Object.entries(byRow)) {
    const row = Number(rowStr)
    rowSegs.sort(segmentSort)
    const laneEnd = []  // laneEnd[lane] = last occupied col in that lane
    for (const seg of rowSegs) {
      let lane = laneEnd.findIndex(end => end < seg.startCol)
      if (lane === -1) { lane = laneEnd.length; laneEnd.push(seg.endCol) }
      else laneEnd[lane] = seg.endCol
      if (lane < maxLanes) {
        segmentsByRow[row].push({ ...seg, lane })
      } else {
        // Surplus — count it against every date it covers for a "+N more".
        for (let c = seg.startCol; c <= seg.endCol; c++) {
          const ds = ymd(rows[row][c])
          overflowByYmd[ds] = (overflowByYmd[ds] || 0) + 1
        }
      }
    }
  }

  return { segmentsByRow, overflowByYmd }
}
