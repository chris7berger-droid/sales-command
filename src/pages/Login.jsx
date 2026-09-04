import { useState, useEffect } from 'react'
import { signIn } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { C as _C } from '../lib/tokens'
import { getTenantConfig, DEFAULTS } from '../lib/config'
import Checkbox from '../components/Checkbox'

const C = { ..._C, linenCard: _C.linenLight, danger: _C.red }

export default function Login() {
  const [email,    setEmail]    = useState(() => localStorage.getItem("sc_last_email") || "")
  const [password, setPassword] = useState("")
  const [companyName, setCompanyName] = useState(DEFAULTS.company_name)

  useEffect(() => { getTenantConfig().then(cfg => setCompanyName(cfg.company_name)) }, [])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const [mode,     setMode]     = useState("login") // login | forgot | reset
  const [message,  setMessage]  = useState(null)
  const [newPassword, setNewPassword] = useState("")
  const [code, setCode] = useState("")
  const [remember, setRemember] = useState(() => localStorage.getItem("sc_remember") !== "false")

  useEffect(() => {
    const hash = window.location.hash || "";
    if (hash.includes("type=recovery") || sessionStorage.getItem("sc_recovery_mode")) {
      sessionStorage.removeItem("sc_recovery_mode")
      setMode("reset")
      window.history.replaceState({}, "", window.location.pathname)
    } else if (localStorage.getItem("sc_reset_pending") === "1") {
      // Resume an in-progress reset. The user MUST leave to fetch the emailed
      // code (and the email can take a minute), so the code-entry screen has to
      // survive navigating away and back — otherwise they return to /login and
      // the screen is gone with no way back to it. Restore mode + their email.
      setMode("reset")
      const savedEmail = localStorage.getItem("sc_reset_email")
      if (savedEmail) setEmail(savedEmail)
    }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      localStorage.setItem("sc_remember", remember ? "true" : "false")
      localStorage.setItem("sc_last_email", email.trim())
      await signIn(email.trim(), password)
      if (!remember) {
        // Mark session as "forget on close" — App.jsx will clear on tab close
        sessionStorage.setItem("sc_session_only", "true")
      } else {
        sessionStorage.removeItem("sc_session_only")
      }
    } catch (err) {
      setError(err.message || "Login failed. Check your email and password.")
    } finally {
      setLoading(false)
    }
  }

  async function handleForgot(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL || "https://pbgvgjjuhnpsumnowuym.supabase.co"}/functions/v1/reset-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_v7XktVvkAlX7y5f6xoFjng_AaLaWKoK" },
          body: JSON.stringify({ email: email.trim() }),
        }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to send reset email.")
      // Move to the code-entry screen. The email carries a 6-digit code (not a
      // clickable link) so email-security scanners can't pre-consume it (B77).
      // Persist so the screen survives the user leaving to fetch the code and
      // coming back (see the resume path in the mount effect above). Cleared on
      // success or "Back to sign in".
      localStorage.setItem("sc_reset_pending", "1")
      localStorage.setItem("sc_reset_email", email.trim())
      setMessage("We emailed you a 6-digit code — it can take a minute to arrive. Enter it below with your new password.")
      setMode("reset")
    } catch (err) {
      setError(err.message || "Failed to send reset email.")
    } finally {
      setLoading(false)
    }
  }

  async function handleReset(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      // Verify the typed 6-digit code — this establishes a recovery session,
      // then updateUser sets the new password against it.
      const { error: vErr } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: "recovery",
      })
      if (vErr) throw new Error(vErr.message === "Token has expired or is invalid"
        ? "That code is invalid or expired. Request a new one."
        : vErr.message)
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      // Reset complete — clear the persisted resume state so /login goes back
      // to normal sign-in.
      localStorage.removeItem("sc_reset_pending")
      localStorage.removeItem("sc_reset_email")
      setMessage("Password updated! Signing you in...")
      // Clear the recovery token from the URL to prevent the PASSWORD_RECOVERY loop
      window.history.replaceState({}, "", window.location.pathname)
      setMode("login")
      // The user is already authenticated after updateUser, trigger a reload
      setTimeout(() => { window.location.replace("/") }, 1200)
    } catch (err) {
      setError(err.message || "Failed to update password.")
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = {
    width: "100%", padding: "11px 14px", borderRadius: 8,
    border: `1.5px solid ${C.borderStrong}`, background: C.linenDeep,
    fontSize: 14, color: C.textBody, outline: "none", boxSizing: "border-box",
    fontFamily: "inherit", WebkitAppearance: "none",
  }

  const btnStyle = {
    width: "100%", padding: "12px", borderRadius: 8, border: "none",
    background: C.teal, color: C.dark, fontSize: 15, fontWeight: 700,
    cursor: "pointer", fontFamily: "inherit", marginTop: 8,
  }

  return (
    <div style={{ minHeight: "100vh", background: C.linen, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <style>{`
        .sc-login-input:-webkit-autofill,
        .sc-login-input:-webkit-autofill:hover,
        .sc-login-input:-webkit-autofill:focus,
        .sc-login-input:-webkit-autofill:active {
          -webkit-box-shadow: 0 0 0 1000px ${C.linenDeep} inset !important;
          -webkit-text-fill-color: ${C.textBody} !important;
          background-color: ${C.linenDeep} !important;
          transition: background-color 5000s ease-in-out 0s !important;
          color-scheme: light !important;
        }
      `}</style>
      <div style={{ width: "100%", maxWidth: 400, background: C.linenCard, borderRadius: 16, border: `1px solid ${C.borderStrong}`, padding: "40px 36px", boxShadow: "0 8px 40px rgba(28,24,20,0.13)" }}>
        
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.textHead, fontFamily: "Barlow Condensed, sans-serif", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Subcon <span style={{ color: C.tealDark }}>Command</span>
          </div>
          <div style={{ fontSize: 12, color: C.textFaint, marginTop: 4 }}>{companyName}</div>
        </div>

        {message && (
          <div style={{ background: "rgba(48,207,172,0.1)", border: `1px solid ${C.teal}`, borderRadius: 8, padding: "12px 16px", fontSize: 13, color: C.tealDark, marginBottom: 20, textAlign: "center" }}>
            {message}
          </div>
        )}

        {error && (
          <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "12px 16px", fontSize: 13, color: C.danger, marginBottom: 20 }}>
            {error}
          </div>
        )}

        {mode === "login" && (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textFaint, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>Email</div>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="sc-login-input" style={inputStyle} required />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textFaint, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>Password</div>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="sc-login-input" style={inputStyle} required />
            </div>
            <Checkbox checked={remember} onChange={setRemember} label="Remember me" size={16} labelStyle={{ fontSize: 13, color: C.textMuted, fontWeight: 400 }} style={{ marginTop: 2 }} />
            <button type="submit" disabled={loading} style={btnStyle}>{loading ? "Signing in..." : "Sign In"}</button>
            <div style={{ textAlign: "center", marginTop: 4 }}>
              <button type="button" onClick={() => { setMode("forgot"); setError(null); setMessage(null); }} style={{ background: "none", border: "none", color: C.tealDark, fontSize: 13, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
                Forgot password?
              </button>
            </div>
          </form>
        )}

        {mode === "forgot" && (
          <form onSubmit={handleForgot} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 13, color: C.textFaint, marginBottom: 4 }}>Enter your email and we will send you a reset code.</div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textFaint, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>Email</div>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} required />
            </div>
            <button type="submit" disabled={loading} style={btnStyle}>{loading ? "Sending..." : "Send Reset Code"}</button>
            <div style={{ textAlign: "center", marginTop: 4 }}>
              <button type="button" onClick={() => { setMode("login"); setError(null); setMessage(null); }} style={{ background: "none", border: "none", color: C.tealDark, fontSize: 13, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
                Back to sign in
              </button>
            </div>
          </form>
        )}

        {mode === "reset" && (
          <form onSubmit={handleReset} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 13, color: C.textFaint, marginBottom: 4 }}>Enter the 6-digit code we emailed you and your new password.</div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textFaint, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>Email</div>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} required />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textFaint, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>Reset Code</div>
              <input type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))} style={{ ...inputStyle, letterSpacing: "0.3em", fontFamily: "monospace" }} placeholder="Enter code" required />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textFaint, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>New Password</div>
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} style={inputStyle} required minLength={6} />
            </div>
            <button type="submit" disabled={loading} style={btnStyle}>{loading ? "Updating..." : "Set New Password"}</button>
            <div style={{ textAlign: "center", marginTop: 4, display: "flex", flexDirection: "column", gap: 10 }}>
              <button type="button" onClick={() => { setMode("forgot"); setError(null); setMessage(null); setCode(""); }} style={{ background: "none", border: "none", color: C.tealDark, fontSize: 13, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
                Request a new code
              </button>
              <button type="button" onClick={() => { localStorage.removeItem("sc_reset_pending"); localStorage.removeItem("sc_reset_email"); setMode("login"); setError(null); setMessage(null); setCode(""); }} style={{ background: "none", border: "none", color: C.textFaint, fontSize: 13, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
                Back to sign in
              </button>
            </div>
          </form>
        )}

      </div>
    </div>
  )
}
