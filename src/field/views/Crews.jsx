import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { C, F } from "../../lib/tokens";
import { tod } from "../../lib/utils";
import Btn from "../../components/Btn";
import FieldScreen, {
  StatStrip,
  FilterChips,
  StatusChip,
  ErrorNote,
  PlainTable,
  RefreshBtn,
} from "../components/FieldScreen";
import { useAsync } from "../lib/useAsync";
import { fetchFieldCrewBoard } from "../lib/queries";
import {
  CREW_STATUS_FILTERS,
  filterCrewCommandRows,
  flipStoredCrewName,
  lastWeekBounds,
  monthBounds,
  sortCrewCommandRows,
  summarizeCrewCommand,
  thisWeekBounds,
} from "../lib/crewBoard";

const FILTER_INPUT = {
  padding: "7px 12px",
  borderRadius: 7,
  border: `1.5px solid ${C.borderStrong}`,
  background: C.linenDeep,
  color: C.textBody,
  fontSize: 12.5,
  fontFamily: F.ui,
  WebkitAppearance: "none",
  outline: "none",
  minWidth: 0,
};
const FILTER_LABEL = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: C.textFaint,
  fontFamily: F.display,
  marginBottom: 3,
};

const DOT = { teal: C.green, red: C.red, muted: C.textFaint };
const EMPTY_ROWS = [];
const EMPTY_CREWS = [];

function statusTone(row) {
  if (row.kind === "unassigned" || row.statusKey === "no-crew") return "amber";
  if (row.kind === "exception" || row.statusKey === "called-out" || row.statusKey === "no-show") return "red";
  const s = String(row.statusKey || "").toLowerCase();
  if (s === "in progress" || s === "ongoing") return "teal";
  if (s === "scheduled") return "amber";
  if (s === "on hold") return "red";
  return "muted";
}

function ModeBtn({ on, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "6px 10px",
        borderRadius: 7,
        border: `1.5px solid ${on ? C.teal : C.borderStrong}`,
        background: on ? C.dark : C.linenDeep,
        color: on ? C.teal : C.textMuted,
        fontSize: 11,
        fontWeight: 700,
        cursor: "pointer",
        fontFamily: F.display,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </button>
  );
}

function CrewCell({ row }) {
  if (!row.crewDisplay) return <span style={{ color: C.textFaint }}>—</span>;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <span
        aria-hidden
        style={{
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: DOT[row.dot] || C.textFaint,
          flex: "0 0 auto",
        }}
      />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontWeight: 700,
            color: C.textHead,
            fontFamily: F.ui,
            fontSize: 13.5,
            lineHeight: 1.2,
          }}
        >
          {row.crewDisplay}
        </div>
        {row.crewSecondary ? (
          <div style={{ marginTop: 2, fontSize: 11.5, color: C.textFaint, lineHeight: 1.2 }}>
            {row.crewSecondary}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DualLine({ primary, secondary }) {
  if (!primary && !secondary) return <span style={{ color: C.textFaint }}>—</span>;
  return (
    <div>
      <div style={{ color: primary ? C.textHead : C.textFaint, fontWeight: primary ? 600 : 400, lineHeight: 1.25 }}>
        {primary || "—"}
      </div>
      {secondary ? (
        <div style={{ marginTop: 2, fontSize: 11.5, color: C.textFaint, lineHeight: 1.2 }}>{secondary}</div>
      ) : null}
    </div>
  );
}

function dash(value) {
  return value ? value : <span style={{ color: C.textFaint }}>—</span>;
}

function jobNumCell(r) {
  return r.jobNum ? (
    <b style={{ color: C.textHead, fontVariantNumeric: "tabular-nums" }}>#{r.jobNum}</b>
  ) : (
    <span style={{ color: C.textFaint }}>—</span>
  );
}

function dateCell(r) {
  return r.dateLabel || r.date || <span style={{ color: C.textFaint }}>—</span>;
}

function tableColumns({ category, showDate }) {
  const dateCol = showDate
    ? [{ key: "date", label: "Date", render: dateCell }]
    : [];
  const jobNum = { key: "jobNum", label: "Job #", render: jobNumCell };
  const jobName = {
    key: "jobName",
    label: "Job Name",
    render: (r) => <DualLine primary={r.jobName} secondary={r.workType} />,
  };
  const customer = { key: "customer", label: "Customer", render: (r) => dash(r.customer) };
  const location = { key: "location", label: "Location", render: (r) => dash(r.location) };
  const mobilization = { key: "mobilization", label: "Mobilization", render: (r) => dash(r.mobilization) };
  const notes = { key: "notes", label: "Notes", render: (r) => dash(r.notes) };
  const status = {
    key: "status",
    label: "Status",
    render: (r) => <StatusChip tone={statusTone(r)}>{r.statusLabel}</StatusChip>,
  };
  const crew = { key: "crew", label: "Crew", render: (r) => <CrewCell row={r} /> };

  if (category === "unassigned") {
    return [...dateCol, jobNum, jobName, customer, location, mobilization, status, notes];
  }
  if (category === "exceptions") {
    return [
      crew,
      ...dateCol,
      {
        key: "expected",
        label: "Expected Job",
        render: (r) =>
          r.jobNum || r.jobName ? (
            <DualLine primary={r.jobNum ? `#${r.jobNum}` : ""} secondary={r.jobName} />
          ) : (
            <span style={{ color: C.textFaint }}>—</span>
          ),
      },
      {
        key: "exception",
        label: "Exception",
        render: (r) => <StatusChip tone={statusTone(r)}>{r.statusLabel}</StatusChip>,
      },
    ];
  }
  return [crew, ...dateCol, jobNum, jobName, customer, location, status, mobilization, notes];
}

export default function Crews() {
  const navigate = useNavigate();
  const today = tod();
  const [dateMode, setDateMode] = useState("day");
  const [date, setDate] = useState(today);
  const [rangeFrom, setRangeFrom] = useState(thisWeekBounds(today).from);
  const [rangeTo, setRangeTo] = useState(thisWeekBounds(today).to);
  const [preset, setPreset] = useState("this-week");
  const [category, setCategory] = useState("all");
  const [crewName, setCrewName] = useState("");
  const [jobQuery, setJobQuery] = useState("");
  const [status, setStatus] = useState("");

  const from = dateMode === "day" ? date : rangeFrom;
  const to = dateMode === "day" ? date : rangeTo;
  const range = dateMode === "range";
  const { data, loading, error, reload } = useAsync(() => fetchFieldCrewBoard({ from, to }), [from, to]);

  const rows = data?.rows || EMPTY_ROWS;
  const crews = data?.crews || EMPTY_CREWS;
  const rosterSize = data?.rosterSize || crews.length;

  const baseRows = useMemo(
    () => filterCrewCommandRows(rows, { category: "all", crewName, jobQuery, status }),
    [rows, crewName, jobQuery, status]
  );
  const counts = useMemo(() => summarizeCrewCommand(baseRows, { rosterSize }), [baseRows, rosterSize]);
  const shown = useMemo(
    () =>
      sortCrewCommandRows(filterCrewCommandRows(baseRows, { category, crewName, jobQuery, status }), {
        range,
        crewName,
        category,
      }),
    [baseRows, category, crewName, jobQuery, status, range]
  );

  function setCategoryFilter(next) {
    setCategory((cur) => (cur === next ? "all" : next));
  }

  function applyPreset(next) {
    const now = tod();
    setPreset(next);
    if (next === "this-week") {
      const b = thisWeekBounds(now);
      setRangeFrom(b.from);
      setRangeTo(b.to);
    } else if (next === "last-week") {
      const b = lastWeekBounds(now);
      setRangeFrom(b.from);
      setRangeTo(b.to);
    } else if (next === "this-month") {
      const b = monthBounds(now);
      setRangeFrom(b.from);
      setRangeTo(b.to);
    }
  }

  function switchToRange() {
    setDateMode("range");
    if (preset !== "custom") applyPreset(preset === "this-week" || preset === "last-week" || preset === "this-month" ? preset : "this-week");
  }

  function clearFilters() {
    const now = tod();
    setDateMode("day");
    setDate(now);
    const week = thisWeekBounds(now);
    setRangeFrom(week.from);
    setRangeTo(week.to);
    setPreset("this-week");
    setCategory("all");
    setCrewName("");
    setJobQuery("");
    setStatus("");
  }

  const showDate = range || category === "exceptions";
  const simpleHints = dateMode === "day" && !crewName && !jobQuery && !status;
  const columns = tableColumns({ category, showDate });

  let empty = "No crews or unassigned jobs for this date.";
  if (loading) empty = "Loading…";
  else if (category === "unassigned") empty = "No unassigned scheduled jobs in this date range.";
  else if (category === "exceptions") empty = "No recorded exceptions in this date range.";
  else if (range) empty = "No crew assignments in this date range.";

  return (
    <FieldScreen
      title="Crews"
      subtitle="Who's where. What's the plan."
      right={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Btn v="teal" sz="sm" onClick={() => navigate("/schedule/schedule")}>
            + View Schedule
          </Btn>
          <RefreshBtn onClick={reload} loading={loading} />
        </div>
      }
    >
      <StatStrip
        items={[
          {
            id: "out",
            label: "Crews Out",
            value: counts.crewsOut,
            hint: simpleHints ? `of ${counts.crewsTotal} total` : range ? "people" : null,
            tone: "teal",
            selected: category === "out",
            onClick: () => setCategoryFilter("out"),
          },
          {
            id: "covered",
            label: "Jobs Covered",
            value: counts.jobsCovered,
            hint: simpleHints ? `of ${counts.scheduledJobs} scheduled` : range ? "jobs" : null,
            tone: "teal",
            selected: category === "covered",
            onClick: () => setCategoryFilter("covered"),
          },
          {
            id: "unassigned",
            label: "Jobs Unassigned",
            value: counts.jobsUnassigned,
            hint: range ? "jobs" : null,
            tone: "amber",
            selected: category === "unassigned",
            onClick: () => setCategoryFilter("unassigned"),
          },
          {
            id: "exceptions",
            label: "Exceptions",
            value: counts.exceptions,
            hint: range ? "records" : null,
            tone: "red",
            selected: category === "exceptions",
            onClick: () => setCategoryFilter("exceptions"),
          },
        ]}
      />

      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "flex-end",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={FILTER_LABEL}>Date</span>
          <div style={{ display: "flex", gap: 6 }}>
            <ModeBtn on={dateMode === "day"} onClick={() => setDateMode("day")}>
              Single Day
            </ModeBtn>
            <ModeBtn on={dateMode === "range"} onClick={switchToRange}>
              Date Range
            </ModeBtn>
          </div>
        </div>
        {dateMode === "day" ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={FILTER_LABEL}>Day</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value || tod())}
              style={{ ...FILTER_INPUT, width: 160 }}
            />
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={FILTER_LABEL}>Range</span>
              <select
                value={preset}
                onChange={(e) => applyPreset(e.target.value)}
                style={{ ...FILTER_INPUT, width: 140, cursor: "pointer" }}
              >
                <option value="this-week">This Week</option>
                <option value="last-week">Last Week</option>
                <option value="this-month">This Month</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={FILTER_LABEL}>From</span>
              <input
                type="date"
                value={rangeFrom}
                onChange={(e) => {
                  setPreset("custom");
                  setRangeFrom(e.target.value || rangeFrom);
                }}
                style={{ ...FILTER_INPUT, width: 150 }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={FILTER_LABEL}>To</span>
              <input
                type="date"
                value={rangeTo}
                onChange={(e) => {
                  setPreset("custom");
                  setRangeTo(e.target.value || rangeTo);
                }}
                style={{ ...FILTER_INPUT, width: 150 }}
              />
            </div>
          </>
        )}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={FILTER_LABEL}>Crew</span>
          <select
            value={crewName}
            onChange={(e) => setCrewName(e.target.value)}
            style={{ ...FILTER_INPUT, width: 180, cursor: "pointer" }}
          >
            <option value="">All Crews</option>
            {crews.map((c) => (
              <option key={c.name} value={c.name}>
                {flipStoredCrewName(c.name)}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: "1 1 180px" }}>
          <span style={FILTER_LABEL}>Job</span>
          <input
            placeholder="Search jobs..."
            value={jobQuery}
            onChange={(e) => setJobQuery(e.target.value)}
            style={{ ...FILTER_INPUT, width: "100%" }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={FILTER_LABEL}>Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={{ ...FILTER_INPUT, width: 150, cursor: "pointer" }}
          >
            <option value="">All</option>
            {CREW_STATUS_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={clearFilters}
          style={{
            padding: "7px 14px",
            borderRadius: 20,
            border: `1.5px solid ${C.borderStrong}`,
            background: "transparent",
            color: C.textMuted,
            fontSize: 11.5,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: F.display,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            alignSelf: "flex-end",
          }}
        >
          Clear Filters
        </button>
      </div>

      <FilterChips
        value={category}
        onChange={setCategory}
        options={[
          { id: "all", label: "All", count: baseRows.length },
          { id: "out", label: "Crews Out", count: counts.crewsOut },
          { id: "unassigned", label: "Unassigned", count: counts.jobsUnassigned },
          { id: "exceptions", label: "Exceptions", count: counts.exceptions },
        ]}
      />

      {error ? (
        <ErrorNote>{error}</ErrorNote>
      ) : (
        <>
          <PlainTable
            keyField="id"
            compact
            rows={shown}
            empty={empty}
            rowStyle={(r) => (r.kind === "unassigned" ? { background: C.linenCard } : null)}
            columns={columns}
          />
          {!loading && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: C.textFaint, fontFamily: F.body }}>
              Showing {shown.length}
            </div>
          )}
        </>
      )}
    </FieldScreen>
  );
}
