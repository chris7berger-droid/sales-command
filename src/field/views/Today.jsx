import FieldScreen, { FieldStub } from "../components/FieldScreen";

// The at-a-glance list: one row per job going today —
// Job · Crew · Hrs · SOD · MOD · EOD · PRT · Load-out.
// Real data + late-form "!" (reusing the phone's rule) lands in the next build step.
export default function Today() {
  return (
    <FieldScreen title="Today" subtitle="Every job running today, at a glance">
      <FieldStub note="Today list (Job · Crew · Hrs · SOD · MOD · EOD · PRT · Load-out) — wiring next." />
    </FieldScreen>
  );
}
