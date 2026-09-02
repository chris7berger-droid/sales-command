import { C, F } from "../../lib/tokens";

// Shared chrome for every Field web screen: a titled header band + content well.
// View-only office screens — no toolbar actions (Manager/Admin corrections come later).
export default function FieldScreen({ title, subtitle, right, children }) {
  return (
    <div style={{ fontFamily: F.ui, color: C.textBody }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 18,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 26,
              fontWeight: 800,
              color: C.textHead,
              fontFamily: F.display,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {title}
          </h1>
          {subtitle && (
            <div style={{ marginTop: 4, fontSize: 13.5, color: C.textFaint }}>{subtitle}</div>
          )}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

// A plain "wired next" body for screens whose interiors ship in a later design session.
export function FieldStub({ note }) {
  return (
    <div
      style={{
        border: `1px dashed ${C.borderStrong}`,
        borderRadius: 10,
        background: C.linenCard,
        padding: "40px 24px",
        textAlign: "center",
        color: C.textLight,
        fontSize: 14,
      }}
    >
      {note || "This screen's layout is designed in a later UI session."}
    </div>
  );
}
