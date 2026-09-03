import { Routes, Route, Navigate } from "react-router-dom";
import Today from "./views/Today";
import Jobs from "./views/Jobs";
import Crews from "./views/Crews";
import TimeClock from "./views/TimeClock";
import DailyLogs from "./views/DailyLogs";
import LoadOuts from "./views/LoadOuts";

// Field Command — the office web side of the crew app (Phase 3).
// View-only: reads tables the phones already sync (jobs, job_crew, time_punches,
// job_wtcs, daily_log_entries, daily_production_reports, job_material_checks, call_log).
// Mounted at /field/* by App.jsx under GroupGuard; owns its own nested routes.
// Far simpler than ScheduleLayout — no toolbar actions, no modals of its own,
// no CSS fence (screens are authored fresh in the host design tokens).
export default function FieldLayout({ teamMember }) {
  return (
    <Routes>
      <Route index element={<Navigate to="/field/today" replace />} />
      <Route path="today" element={<Today teamMember={teamMember} />} />
      <Route path="jobs" element={<Jobs teamMember={teamMember} />} />
      <Route path="crews" element={<Crews teamMember={teamMember} />} />
      <Route path="timeclock" element={<TimeClock teamMember={teamMember} />} />
      <Route path="dailylogs" element={<DailyLogs teamMember={teamMember} />} />
      <Route path="loadouts" element={<LoadOuts teamMember={teamMember} />} />
      <Route path="*" element={<Navigate to="/field/today" replace />} />
    </Routes>
  );
}
