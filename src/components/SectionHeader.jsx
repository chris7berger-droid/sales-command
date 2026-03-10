import { C, F } from "../lib/tokens";

export default function SectionHeader({ title, action }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 20,
    }}>
      <h2 style={{
        margin: 0,
        fontSize: 22,
        fontWeight: 800,
        color: C.textHead,
        fontFamily: F.display,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}>
        {title}
      </h2>
      {action}
    </div>
  );
}