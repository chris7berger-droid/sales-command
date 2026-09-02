import FieldScreen, { FieldStub } from "../components/FieldScreen";

export default function TimeClock() {
  return (
    <FieldScreen title="Time Clock" subtitle="Crew punches, by job and day">
      <FieldStub note="Punch review + office corrections ship in a later design session." />
    </FieldScreen>
  );
}
