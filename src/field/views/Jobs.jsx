import FieldScreen, { FieldStub } from "../components/FieldScreen";

export default function Jobs() {
  return (
    <FieldScreen title="Jobs" subtitle="Every active field job, view-only for the office">
      <FieldStub note="Job list + drill-in ships in a later design session." />
    </FieldScreen>
  );
}
