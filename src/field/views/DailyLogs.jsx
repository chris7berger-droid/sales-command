import FieldScreen, { FieldStub } from "../components/FieldScreen";

export default function DailyLogs() {
  return (
    <FieldScreen title="Daily Logs" subtitle="Start-of-day, mid-day, and end-of-day entries">
      <FieldStub note="Daily log timeline ships in a later design session." />
    </FieldScreen>
  );
}
