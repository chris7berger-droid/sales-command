import FieldScreen, { FieldStub } from "../components/FieldScreen";

export default function Crews() {
  return (
    <FieldScreen title="Crews" subtitle="Who's assigned where">
      <FieldStub note="Crew roster + assignments ship in a later design session." />
    </FieldScreen>
  );
}
