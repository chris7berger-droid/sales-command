import { useState } from "react";
import { C, F, GLOBAL_CSS } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import { SalesCommandMark } from "./Logo";

export default function WelcomeScreen({ teamMember, onComplete }) {
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");

  const handleGetStarted = async () => {
    setError("");
    if (!password || password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    const { error: pwErr } = await supabase.auth.updateUser({ password });
    if (pwErr) {
      setError(pwErr.message);
      setLoading(false);
      return;
    }
    const { error: obErr } = await supabase
      .from("team_members")
      .update({ onboarded: true })
      .eq("id", teamMember.id);
    if (obErr) {
      setError("Could not complete onboarding. Please contact your admin.");
      setLoading(false);
      return;
    }
    onComplete();
  };

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div style={{
        minHeight: "100vh",
        background: C.dark,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}>
        <div style={{
          width: "100%",
          maxWidth: 520,
          textAlign: "center",
        }}>
          {/* Logo */}
          <div style={{ marginBottom: 32 }}>
            <SalesCommandMark size={52} />
          </div>

          {/* Welcome heading */}
          <h1 style={{
            fontSize: 28,
            fontWeight: 800,
            color: "#fff",
            fontFamily: F.display,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            margin: 0,
            lineHeight: 1.2,
          }}>
            Welcome to Sales <span style={{ color: C.teal }}>Command</span>
          </h1>
          <div style={{
            fontSize: 14,
            color: "rgba(255,255,255,0.5)",
            fontFamily: F.ui,
            marginTop: 8,
          }}>
            You're all set. Here's what we have on file for you.
          </div>

          {/* Info card */}
          <div style={{
            background: C.darkRaised,
            border: `1px solid ${C.darkBorder}`,
            borderRadius: 14,
            padding: "24px 28px",
            marginTop: 28,
            textAlign: "left",
          }}>
            <InfoRow label="Name" value={teamMember.name} />
            <InfoRow label="Email" value={teamMember.email} />
            <InfoRow label="Role" value={teamMember.role} />
          </div>

          {/* Instruction manual callout */}
          <div style={{
            background: "rgba(48,207,172,0.08)",
            border: `1px solid ${C.tealBorder}`,
            borderRadius: 14,
            padding: "20px 24px",
            marginTop: 18,
            textAlign: "left",
            display: "flex",
            gap: 16,
            alignItems: "flex-start",
          }}>
            {/* Mini page badge mockup */}
            <div style={{
              flexShrink: 0,
              background: C.dark,
              color: C.teal,
              border: `1.5px solid ${C.tealBorder}`,
              borderRadius: 16,
              padding: "5px 10px",
              fontSize: 11,
              fontWeight: 800,
              fontFamily: F.display,
              letterSpacing: "0.06em",
              whiteSpace: "nowrap",
            }}>
              p. 1
            </div>
            <div>
              <div style={{
                fontSize: 14,
                fontWeight: 700,
                color: C.teal,
                fontFamily: F.display,
                letterSpacing: "0.03em",
                marginBottom: 4,
              }}>
                The Directory
              </div>
              <div style={{
                fontSize: 13,
                color: "rgba(255,255,255,0.55)",
                fontFamily: F.ui,
                lineHeight: 1.5,
              }}>
                Every screen has a page number in the bottom-right corner. Tap it
                anytime to open The Directory — it explains what each
                screen does, every button you can tap, and where it leads.
              </div>
            </div>
          </div>

          {/* Create password */}
          <div style={{
            background: C.darkRaised,
            border: `1px solid ${C.darkBorder}`,
            borderRadius: 14,
            padding: "24px 28px",
            marginTop: 18,
            textAlign: "left",
          }}>
            <div style={{
              fontSize: 14,
              fontWeight: 700,
              color: C.teal,
              fontFamily: F.display,
              letterSpacing: "0.03em",
              marginBottom: 16,
            }}>
              Create Your Password
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6, fontFamily: F.ui }}>Password</div>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1.5px solid ${C.darkBorder}`, background: C.dark, fontSize: 14, color: "#fff", outline: "none", boxSizing: "border-box", fontFamily: F.ui }}
                onFocus={e => e.target.style.borderColor = C.teal}
                onBlur={e => e.target.style.borderColor = C.darkBorder}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6, fontFamily: F.ui }}>Confirm Password</div>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1.5px solid ${C.darkBorder}`, background: C.dark, fontSize: 14, color: "#fff", outline: "none", boxSizing: "border-box", fontFamily: F.ui }}
                onFocus={e => e.target.style.borderColor = C.teal}
                onBlur={e => e.target.style.borderColor = C.darkBorder}
              />
            </div>
            {error && (
              <div style={{ fontSize: 12, color: C.red, fontFamily: F.ui, marginTop: 12 }}>{error}</div>
            )}
          </div>

          {/* Get Started button */}
          <button
            onClick={handleGetStarted}
            disabled={loading || !password}
            style={{
              marginTop: 28,
              background: C.teal,
              color: C.dark,
              border: "none",
              borderRadius: 10,
              padding: "14px 40px",
              fontSize: 16,
              fontWeight: 800,
              fontFamily: F.display,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.7 : 1,
              transition: "opacity 0.15s",
            }}
          >
            {loading ? "Loading..." : "Get Started"}
          </button>

          <div style={{
            fontSize: 11,
            color: "rgba(255,255,255,0.25)",
            fontFamily: F.ui,
            marginTop: 14,
          }}>
            If any of the above info is wrong, let your admin know.
          </div>
        </div>
      </div>
    </>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "10px 0",
      borderBottom: `1px solid ${C.darkBorder}`,
    }}>
      <span style={{
        fontSize: 11,
        fontWeight: 700,
        color: "rgba(255,255,255,0.4)",
        fontFamily: F.ui,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 14,
        fontWeight: 600,
        color: "#fff",
        fontFamily: F.ui,
      }}>
        {value || "—"}
      </span>
    </div>
  );
}
