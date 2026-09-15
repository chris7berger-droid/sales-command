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
import { CREW_STATUS_FILTERS, filterCrewCommandRows, flipStoredCrewName } from "../lib/crewBoard";

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
const EMPTY_COUNTS = {
  crewsOut: 0,
  crewsTotal: 0,
  jobsCovered: 0,
  scheduledJobs: 0,
  jobsUnassigned: 0,
  crewsOff: 0,
};

function statusTone(row) {
  if (row.kind === "unassigned") return "amber";
  if (row.kind === "off") return "red";
  const s = String(row.statusKey || "").toLowerCase();
  if (s === "in progress" || s === "ongoing") return "teal";
  if (s === "scheduled") return "amber";
  if (s === "on hold") return "red";
  return "muted";
}

function CrewCell({ row }) {
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

export default function Crews() {
  const navigate = useNavigate();
  const [date, setDate] = useState(tod);
  const [category, setCategory] = useState("all");
  const [crewName, setCrewName] = useState("");
  const [jobQuery, setJobQuery] = useState("");
  const [status, setStatus] = useState("");
  const { data, loading, error, reload } = useAsync(() => fetchFieldCrewBoard({ date }), [date]);

  const rows = data?.rows || EMPTY_ROWS;
  const counts = data?.counts || EMPTY_COUNTS;
  const crews = data?.crews || EMPTY_CREWS;

  const shown = useMemo(
    () => filterCrewCommandRows(data?.rows, { category, crewName, jobQuery, status }),
    [data, category, crewName, jobQuery, status]
  );

  function setCategoryFilter(next) {
    setCategory((cur) => (cur === next ? "all" : next));
  }

  function clearFilters() {
    setDate(tod());
    setCategory("all");
    setCrewName("");
    setJobQuery("");
    setStatus("");
  }

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
            hint: `of ${counts.crewsTotal} total`,
            tone: "teal",
            selected: category === "out",
            onClick: () => setCategoryFilter("out"),
          },
          {
            id: "covered",
            label: "Jobs Covered",
            value: counts.jobsCovered,
            hint: `of ${counts.scheduledJobs} scheduled`,
            tone: "teal",
            selected: category === "covered",
            onClick: () => setCategoryFilter("covered"),
          },
          {
            id: "unassigned",
            label: "Jobs Unassigned",
            value: counts.jobsUnassigned,
            tone: "amber",
            selected: category === "unassigned",
            onClick: () => setCategoryFilter("unassigned"),
          },
          {
            id: "off",
            label: "Crews Off",
            value: counts.crewsOff,
            tone: "red",
            selected: category === "off",
            onClick: () => setCategoryFilter("off"),
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
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value || tod())}
            style={{ ...FILTER_INPUT, width: 168 }}
          />
        </div>
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
            style={{ ...FILTER_INPUT, width: 160, cursor: "pointer" }}
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
          { id: "all", label: "All", count: rows.length },
          { id: "out", label: "Crews Out", count: counts.crewsOut },
          { id: "unassigned", label: "Unassigned", count: counts.jobsUnassigned },
          { id: "off", label: "Crews Off", count: counts.crewsOff },
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
            empty={loading ? "Loading…" : "No crews or unassigned jobs for this date."}
            rowStyle={(r) => (r.kind === "unassigned" ? { background: C.linenCard } : null)}
            columns={[
              { key: "crew", label: "Crew", render: (r) => <CrewCell row={r} /> },
              {
                key: "jobNum",
                label: "Job #",
                render: (r) =>
                  r.jobNum ? (
                    <b style={{ color: C.textHead, fontVariantNumeric: "tabular-nums" }}>#{r.jobNum}</b>
                  ) : (
                    <span style={{ color: C.textFaint }}>—</span>
                  ),
              },
              {
                key: "jobName",
                label: "Job Name",
                render: (r) => <DualLine primary={r.jobName} secondary={r.workType} />,
              },
              {
                key: "customer",
                label: "Customer",
                render: (r) => r.customer || <span style={{ color: C.textFaint }}>—</span>,
              },
              {
                key: "location",
                label: "Location",
                render: (r) => r.location || <span style={{ color: C.textFaint }}>—</span>,
              },
              {
                key: "status",
                label: "Status",
                render: (r) => <StatusChip tone={statusTone(r)}>{r.statusLabel}</StatusChip>,
              },
              {
                key: "mobilization",
                label: "Mobilization",
                render: (r) => r.mobilization || <span style={{ color: C.textFaint }}>—</span>,
              },
              {
                key: "notes",
                label: "Notes",
                render: (r) => r.notes || <span style={{ color: C.textFaint }}>—</span>,
              },
            ]}
          />
          {!loading && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: C.textFaint, fontFamily: F.body }}>
              Showing {shown.length} crew{shown.length === 1 ? "" : "s"}/job{shown.length === 1 ? "" : "s"}
            </div>
          )}
        </>
      )}
    </FieldScreen>
  );
}
