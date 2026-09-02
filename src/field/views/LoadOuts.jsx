import FieldScreen, { FieldStub } from "../components/FieldScreen";

// Load-Outs is a SHORTCUT into Schedule's existing LoadOutModal (two doors, one room).
// The job list + modal wiring lands in its own build step (shared hydrateLoadOutJob).
export default function LoadOuts() {
  return (
    <FieldScreen title="Load-Outs" subtitle="Material load-outs for today's jobs">
      <FieldStub note="Opens the same load-out sheet used on the Schedule side — wiring next." />
    </FieldScreen>
  );
}
