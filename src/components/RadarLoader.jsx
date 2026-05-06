import { useState, useEffect } from "react";
import { C } from "../lib/tokens";

// Sales Command radar boot loader.
// Adapted from Claude Design "Radar Loading" (sweep variant, full HUD).
// Self-contained: animation, telemetry, log feed, scanlines, vignette.
// Props let callers override label / size / accent without forking the file.

const CAT = {
  lead:     { color: "ACCENT",  label: "LEAD",        glyph: "◆" },
  proposal: { color: "#F0B61F", label: "PROPOSAL",    glyph: "▲" },
  job:      { color: "#3D8FFF", label: "JOB",         glyph: "■" },
  over:     { color: "#FF3B5C", label: "OVER BUDGET", glyph: "▼" },
  under:    { color: "ACCENT",  label: "UNDER BUDGET",glyph: "●" },
  hold:     { color: "#7C8696", label: "ON HOLD",     glyph: "◐" },
};

const RECORDS = [
  { angle: 14,  dist: 0.42, cat: "lead",     name: "ACME Industrial",       value: "$48k"  },
  { angle: 38,  dist: 0.71, cat: "proposal", name: "Northwind Logistics",   value: "$120k" },
  { angle: 67,  dist: 0.55, cat: "job",      name: "Halberg Tower Reno",    value: "$340k" },
  { angle: 96,  dist: 0.83, cat: "over",     name: "Pier 9 Refit",          value: "$1.2M" },
  { angle: 128, dist: 0.38, cat: "lead",     name: "Stratos Holdings",      value: "$22k"  },
  { angle: 156, dist: 0.62, cat: "under",    name: "Cedar Park HVAC",       value: "$78k"  },
  { angle: 188, dist: 0.78, cat: "job",      name: "Marina Bay Phase 2",    value: "$890k" },
  { angle: 218, dist: 0.46, cat: "proposal", name: "Belmont Office Park",   value: "$215k" },
  { angle: 246, dist: 0.84, cat: "hold",     name: "Glenwood Estates",      value: "$64k"  },
  { angle: 278, dist: 0.52, cat: "lead",     name: "Riverstone Capital",    value: "$95k"  },
  { angle: 308, dist: 0.69, cat: "job",      name: "Bayside Industrial",    value: "$510k" },
  { angle: 338, dist: 0.34, cat: "proposal", name: "Hartwell & Associates", value: "$160k" },
];

const STATUS_LINES = [
  "INDEXING LEADS",
  "SYNCING PROPOSALS",
  "CALCULATING PIPELINE",
  "FLAGGING OVER-BUDGET JOBS",
  "RESOLVING IN-PROGRESS WORK",
  "RECONCILING ON-HOLD ITEMS",
  "SCORING NEW OPPORTUNITIES",
  "AGGREGATING REGION DATA",
];

const TARGETS = {
  leads: 1284, proposals: 312, jobs: 87, pipeline: 4_820_000, over: 6, hold: 14,
};
const ramp = (t, target, tau = 5) => Math.floor(target * (1 - Math.exp(-t / tau)));

const hex2rgba = (hex, a) => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
};

const useRaf = () => {
  const [t, setT] = useState(0);
  useEffect(() => {
    let id, start;
    const tick = (ts) => {
      if (start === undefined) start = ts;
      setT((ts - start) / 1000);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);
  return t;
};

const Crosshair = ({ size = 64, color, strokeWidth = 2.2 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none"
       style={{ filter: `drop-shadow(0 0 6px ${color}88)` }}>
    <circle cx="32" cy="32" r="20" stroke={color} strokeWidth={strokeWidth} />
    <line x1="32" y1="2"  x2="32" y2="14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <line x1="32" y1="50" x2="32" y2="62" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <line x1="2"  y1="32" x2="14" y2="32" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <line x1="50" y1="32" x2="62" y2="32" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <circle cx="32" cy="32" r="2.5" fill={color} />
  </svg>
);

const SweepRadar = ({ accent, size, speed }) => {
  const t = useRaf();
  const angle = (t * 360 / speed) % 360;
  const r = size / 2;
  const dim = hex2rgba(accent, 0.18);
  const faint = hex2rgba(accent, 0.06);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <defs>
        <radialGradient id="rl-bg" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor={hex2rgba(accent, 0.10)} />
          <stop offset="60%"  stopColor={hex2rgba(accent, 0.03)} />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
        <linearGradient id="rl-sweep" x1="0%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%"   stopColor={hex2rgba(accent, 0)} />
          <stop offset="60%"  stopColor={hex2rgba(accent, 0.05)} />
          <stop offset="95%"  stopColor={hex2rgba(accent, 0.55)} />
          <stop offset="100%" stopColor={accent} />
        </linearGradient>
        <clipPath id="rl-circ">
          <circle cx={r} cy={r} r={r - 1} />
        </clipPath>
      </defs>

      <circle cx={r} cy={r} r={r - 1} fill="url(#rl-bg)" />

      <g clipPath="url(#rl-circ)">
        <g stroke={faint} strokeWidth="1">
          {[0, 30, 60, 90, 120, 150].map(a => {
            const rad = (a * Math.PI) / 180;
            const x1 = r + Math.cos(rad) * r;
            const y1 = r + Math.sin(rad) * r;
            const x2 = r - Math.cos(rad) * r;
            const y2 = r - Math.sin(rad) * r;
            return <line key={a} x1={x1} y1={y1} x2={x2} y2={y2} />;
          })}
        </g>

        {[0.25, 0.5, 0.75, 1].map((f, i) => (
          <circle key={i} cx={r} cy={r} r={r * f - 1}
                  fill="none" stroke={dim} strokeWidth="1" />
        ))}

        {RECORDS.map((rec, i) => {
          const cat = CAT[rec.cat];
          const blipColor = cat.color === "ACCENT" ? accent : cat.color;
          let delta = ((angle - rec.angle) % 360 + 360) % 360;
          const life = 4.5;
          const fadeAngle = 360 / speed * life;
          const intensity = delta < fadeAngle ? 1 - delta / fadeAngle : 0;
          if (intensity <= 0) return null;
          const rad = (rec.angle * Math.PI) / 180;
          const bx = r + Math.cos(rad) * rec.dist * (r - 14);
          const by = r + Math.sin(rad) * rec.dist * (r - 14);
          return (
            <g key={i} opacity={intensity}>
              <circle cx={bx} cy={by} r={3 + 3 * intensity} fill={blipColor}
                      style={{ filter: `drop-shadow(0 0 ${6 * intensity}px ${blipColor})` }} />
              <circle cx={bx} cy={by} r={11 * (1 - intensity) + 4}
                      fill="none" stroke={blipColor} strokeWidth="1" opacity={intensity * 0.6} />
              {intensity > 0.55 && (
                <text x={bx + 8} y={by - 6} fill={blipColor}
                      style={{
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: 8, letterSpacing: "0.12em",
                        opacity: (intensity - 0.55) / 0.45,
                      }}>
                  {cat.label} · {rec.value}
                </text>
              )}
            </g>
          );
        })}

        <g transform={`rotate(${angle} ${r} ${r})`}>
          <path d={`M ${r} ${r} L ${r + r} ${r} A ${r} ${r} 0 0 0 ${r + Math.cos(-Math.PI / 2.2) * r} ${r + Math.sin(-Math.PI / 2.2) * r} Z`}
                fill="url(#rl-sweep)" opacity="0.9" />
          <line x1={r} y1={r} x2={r * 2} y2={r}
                stroke={accent} strokeWidth="1.5"
                style={{ filter: `drop-shadow(0 0 4px ${accent})` }} />
        </g>
      </g>

      <circle cx={r} cy={r} r={r - 1} fill="none" stroke={hex2rgba(accent, 0.45)} strokeWidth="1.5" />
      <g stroke={hex2rgba(accent, 0.5)} strokeWidth="1.5">
        {Array.from({ length: 36 }).map((_, i) => {
          const a = (i * 10 * Math.PI) / 180;
          const isMajor = i % 3 === 0;
          const len = isMajor ? 8 : 4;
          const x1 = r + Math.cos(a) * (r - 1);
          const y1 = r + Math.sin(a) * (r - 1);
          const x2 = r + Math.cos(a) * (r - 1 - len);
          const y2 = r + Math.sin(a) * (r - 1 - len);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} opacity={isMajor ? 0.9 : 0.45} />;
        })}
      </g>
    </svg>
  );
};

const TelemetryRow = ({ accent, k, v, color }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: 24, whiteSpace: "nowrap" }}>
    <span style={{ color: hex2rgba(accent, 0.5) }}>{k}</span>
    <span style={{ color: color || accent, fontVariantNumeric: "tabular-nums" }}>{v}</span>
  </div>
);

const Telemetry = ({ accent, t }) => {
  const leads     = ramp(t, TARGETS.leads, 4);
  const proposals = ramp(t, TARGETS.proposals, 5);
  const jobs      = ramp(t, TARGETS.jobs, 6);
  const pipeline  = ramp(t, TARGETS.pipeline, 7);
  const over      = ramp(t, TARGETS.over, 8);
  const hold      = ramp(t, TARGETS.hold, 6);
  const fmt$ = (n) => "$" + (n / 1_000_000).toFixed(2) + "M";

  return (
    <div style={{
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 11, letterSpacing: "0.08em", lineHeight: 1.7, width: 260,
    }}>
      <TelemetryRow accent={accent} k="LEADS"     v={leads.toLocaleString()} />
      <TelemetryRow accent={accent} k="PROPOSALS" v={proposals.toLocaleString()} color="#F0B61F" />
      <TelemetryRow accent={accent} k="JOBS"      v={jobs.toLocaleString()}      color="#3D8FFF" />
      <TelemetryRow accent={accent} k="PIPELINE"  v={fmt$(pipeline)} />
      <TelemetryRow accent={accent} k="OVER"      v={String(over).padStart(2, "0")} color="#FF3B5C" />
      <TelemetryRow accent={accent} k="ON HOLD"   v={String(hold).padStart(2, "0")} color="#7C8696" />
    </div>
  );
};

const Legend = ({ accent }) => {
  const items = [
    { k: "LEAD",     c: accent },
    { k: "PROPOSAL", c: "#F0B61F" },
    { k: "JOB",      c: "#3D8FFF" },
    { k: "OVER",     c: "#FF3B5C" },
    { k: "ON HOLD",  c: "#7C8696" },
  ];
  return (
    <div style={{
      display: "flex", gap: 18,
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 9, letterSpacing: "0.18em",
      color: hex2rgba(accent, 0.6),
    }}>
      {items.map(it => (
        <div key={it.k} style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
          <span style={{
            width: 6, height: 6, borderRadius: 999,
            background: it.c, boxShadow: `0 0 6px ${it.c}`,
          }} />
          {it.k}
        </div>
      ))}
    </div>
  );
};

const StatusLine = ({ accent, label }) => {
  const [idx, setIdx] = useState(0);
  const [dots, setDots] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setIdx(v => (v + 1) % STATUS_LINES.length), 1800);
    const j = setInterval(() => setDots(d => (d + 1) % 4), 400);
    return () => { clearInterval(i); clearInterval(j); };
  }, []);
  const text = label || STATUS_LINES[idx];
  return (
    <div style={{
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 12, letterSpacing: "0.22em",
      color: accent,
      textShadow: `0 0 8px ${hex2rgba(accent, 0.6)}`,
    }}>
      {text}{".".repeat(dots)}{" ".repeat(3 - dots)}
    </div>
  );
};

const ProgressBar = ({ accent, t }) => {
  const pct = Math.min(99, Math.floor(((1 - Math.exp(-t / 8)) * 100)));
  return (
    <div style={{ width: 280, fontFamily: '"JetBrains Mono", monospace' }}>
      <div style={{
        display: "flex", justifyContent: "space-between",
        fontSize: 10, letterSpacing: "0.18em",
        color: hex2rgba(accent, 0.55), marginBottom: 6,
      }}>
        <span>PROGRESS</span>
        <span style={{ color: accent }}>{String(pct).padStart(2, "0")}%</span>
      </div>
      <div style={{ height: 2, background: hex2rgba(accent, 0.12), position: "relative", overflow: "hidden" }}>
        <div style={{
          position: "absolute", inset: 0, width: `${pct}%`,
          background: accent, boxShadow: `0 0 8px ${accent}`,
        }} />
      </div>
      <div style={{ display: "flex", gap: 2, marginTop: 6 }}>
        {Array.from({ length: 28 }).map((_, i) => {
          const lit = i < (pct / 100) * 28;
          return (
            <div key={i} style={{
              flex: 1, height: 6,
              background: lit ? accent : hex2rgba(accent, 0.1),
              opacity: lit ? (0.5 + 0.5 * Math.sin(t * 4 + i * 0.3)) : 1,
            }} />
          );
        })}
      </div>
    </div>
  );
};

const QLabel = ({ accent, bg, pos, children }) => (
  <div style={{
    position: "absolute", ...pos,
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 9, letterSpacing: "0.22em",
    color: hex2rgba(accent, 0.65),
    whiteSpace: "nowrap",
    background: bg, padding: "2px 6px",
    textShadow: `0 0 6px ${hex2rgba(accent, 0.4)}`,
  }}>
    {children}
  </div>
);

const Corner = ({ stroke, s, pos, rot }) => (
  <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}
       style={{ position: "absolute", ...pos, transform: `rotate(${rot}deg)` }}>
    <path d={`M 1 ${s} L 1 1 L ${s} 1`} stroke={stroke} strokeWidth="1.5" fill="none" />
  </svg>
);

const CornerBrackets = ({ accent }) => {
  const c = hex2rgba(accent, 0.45);
  const s = 24;
  const inset = 20;
  return (
    <>
      <Corner stroke={c} s={s} pos={{ top: inset, left: inset }}  rot={0} />
      <Corner stroke={c} s={s} pos={{ top: inset, right: inset }} rot={90} />
      <Corner stroke={c} s={s} pos={{ bottom: inset, right: inset }} rot={180} />
      <Corner stroke={c} s={s} pos={{ bottom: inset, left: inset }}  rot={270} />
    </>
  );
};

const LogFeed = ({ accent, t }) => {
  const messages = [
    { tag: "NEW", text: "Lead · ACME Industrial · $48k",         c: "ACCENT" },
    { tag: "OK",  text: "Proposal sent · Northwind Logistics",   c: "ACCENT" },
    { tag: "WIN", text: "Halberg Tower Reno moved to In Progress", c: "ACCENT" },
    { tag: "!!",  text: "Pier 9 Refit — 14% over budget",        c: "#FF3B5C" },
    { tag: "NEW", text: "Lead · Stratos Holdings · $22k",        c: "ACCENT" },
    { tag: "OK",  text: "Cedar Park HVAC closed under budget",   c: "ACCENT" },
    { tag: "..",  text: "Marina Bay Phase 2 milestone synced",   c: "ACCENT" },
    { tag: "OK",  text: "Belmont Office Park · proposal v3 drafted", c: "ACCENT" },
    { tag: "..",  text: "Glenwood Estates placed on hold",       c: "#7C8696" },
    { tag: "NEW", text: "Lead · Riverstone Capital · $95k",      c: "ACCENT" },
    { tag: "WIN", text: "Bayside Industrial signed · $510k",     c: "ACCENT" },
    { tag: "OK",  text: "Hartwell & Associates · proposal queued", c: "ACCENT" },
  ];
  const lineCount = 6;
  const lineIdx = Math.floor(t * 1.6);

  return (
    <div style={{
      position: "absolute", bottom: 28, left: 28,
      fontFamily: '"JetBrains Mono", monospace', fontSize: 10,
      letterSpacing: "0.04em", lineHeight: 1.85,
      color: hex2rgba(accent, 0.5),
      width: 420,
    }}>
      <div style={{ color: hex2rgba(accent, 0.55), letterSpacing: "0.22em", marginBottom: 6 }}>
        ◢ ACTIVITY FEED
      </div>
      {Array.from({ length: lineCount }).map((_, i) => {
        const m = messages[(lineIdx - i + messages.length * 100) % messages.length];
        const opacity = 1 - i * 0.14;
        const tagColor = m.c === "ACCENT" ? accent : m.c;
        return (
          <div key={i} style={{ opacity, display: "flex", gap: 8, whiteSpace: "nowrap" }}>
            <span style={{ flex: "none", color: hex2rgba(accent, 0.4), fontVariantNumeric: "tabular-nums" }}>
              {String((lineIdx - i + 10000)).padStart(5, "0")}
            </span>
            <span style={{
              flex: "none", color: tagColor, minWidth: 32,
              textShadow: i === 0 ? `0 0 6px ${tagColor}` : "none",
            }}>
              [{m.tag}]
            </span>
            <span style={{
              flex: 1, minWidth: 0,
              overflow: "hidden", textOverflow: "ellipsis",
              color: i === 0 ? accent : "inherit",
            }}>{m.text}</span>
          </div>
        );
      })}
    </div>
  );
};

export default function RadarLoader({
  accent = C.teal,
  size = 380,
  speed = 3.2,
  label = "",
  bg = C.dark,
}) {
  const time = useRaf();

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: bg,
      overflow: "hidden",
      display: "grid", placeItems: "center",
      zIndex: 9999,
    }}>
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: `
          linear-gradient(${hex2rgba(accent, 0.04)} 1px, transparent 1px),
          linear-gradient(90deg, ${hex2rgba(accent, 0.04)} 1px, transparent 1px)
        `,
        backgroundSize: "48px 48px",
        maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
        WebkitMaskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
      }} />

      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        backgroundImage: "repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 1px, transparent 1px, transparent 3px)",
        mixBlendMode: "overlay",
      }} />

      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.7) 100%)",
      }} />

      <CornerBrackets accent={accent} />

      <div style={{ position: "absolute", top: 28, left: 28 }}>
        <div style={{
          fontFamily: '"JetBrains Mono", monospace', fontSize: 10,
          letterSpacing: "0.22em", color: hex2rgba(accent, 0.55),
          marginBottom: 8,
        }}>
          ◢ SALES COMMAND // PIPELINE SCAN
        </div>
        <Telemetry accent={accent} t={time} />
      </div>

      <div style={{
        position: "absolute", top: 28, right: 28, textAlign: "right",
        fontFamily: '"JetBrains Mono", monospace', fontSize: 10,
        letterSpacing: "0.22em", color: hex2rgba(accent, 0.55),
      }}>
        <div>REGION <span style={{ color: accent }}>● ALL · 6 SECTORS</span></div>
        <div style={{ marginTop: 6 }}>SCAN T+ <span style={{ color: accent }}>{time.toFixed(2).padStart(7, "0")}s</span></div>
      </div>

      <div style={{
        position: "relative",
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: 32,
      }}>
        <div style={{ position: "relative", width: size, height: size }}>
          <SweepRadar accent={accent} size={size} speed={speed} />
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
          }}>
            <Crosshair size={Math.round(size * 0.18)} color={accent} />
          </div>

          <QLabel accent={accent} bg={bg} pos={{ top: -8, left: "50%", transform: "translateX(-50%)" }}>N · NEW LEADS</QLabel>
          <QLabel accent={accent} bg={bg} pos={{ right: -10, top: "50%", transform: "translateY(-50%)" }}>E · PROPOSALS</QLabel>
          <QLabel accent={accent} bg={bg} pos={{ bottom: -8, left: "50%", transform: "translateX(-50%)" }}>S · IN PROGRESS</QLabel>
          <QLabel accent={accent} bg={bg} pos={{ left: -10, top: "50%", transform: "translateY(-50%)" }}>W · CLOSED</QLabel>
        </div>

        <StatusLine accent={accent} label={label} />
        <ProgressBar accent={accent} t={time} />
        <Legend accent={accent} />
      </div>

      <LogFeed accent={accent} t={time} />
    </div>
  );
}
