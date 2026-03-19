import { useState, useEffect } from 'react'
import { signIn } from '../lib/auth'
import { supabase } from '../lib/supabase'

const C = {
  linen:      '#b5a896',
  linenCard:  '#bfb3a1',
  linenDeep:  '#a89b88',
  teal:       '#30cfac',
  tealDark:   '#1a8a72',
  textHead:   '#1c1814',
  textBody:   '#2d2720',
  textFaint:  '#887c6e',
  border:     'rgba(28,24,20,0.12)',
  borderStrong: 'rgba(28,24,20,0.2)',
  danger:     '#ef4444',
}

export default function Login() {
  const [email,    setEmail]    = useState("")
  const [password, setPassword] = useState("")
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const [mode,     setMode]     = useState("login") // login | forgot | reset
  const [message,  setMessage]  = useState(null)
  const [newPassword, setNewPassword] = useState("")

  useEffect(() => {
    const hash = window.location.hash
    if (hash.includes("type=recovery")) {
      setMode("reset")
    }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await signIn(email.trim(), password)
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
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: "https://www.scmybiz.com"
      })
      if (error) throw error
      setMessage("Check your email for a password reset link.")
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
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      setMessage("Password updated! Redirecting...")
      setTimeout(() => { window.location.href = "https://www.scmybiz.com" }, 1500)
    } catch (err) {
      setError(err.message || "Failed to update password.")
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = {
    width: "100%", padding: "11px 14px", borderRadius: 8,
    border: `1.5px solid ${C.borderStrong}`, background: C.linenCard,
    fontSize: 14, color: C.textBody, outline: "none", boxSizing: "border-box",
    fontFamily: "inherit",
  }

  const btnStyle = {
    width: "100%", padding: "12px", borderRadius: 8, border: "none",
    background: C.teal, color: "white", fontSize: 15, fontWeight: 700,
    cursor: "pointer", fontFamily: "inherit", marginTop: 8,
  }

  return (
    <div style={{ minHeight: "100vh", background: C.linen, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 400, background: C.linenCard, borderRadius: 16, border: `1px solid ${C.borderStrong}`, padding: "40px 36px", boxShadow: "0 8px 40px rgba(28,24,20,0.13)" }}>
        
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.textHead, fontFamily: "Barlow Condensed, sans-serif", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Sales <span style={{ color: C.tealDark }}>Command</span>
          </div>
          <div style={{ fontSize: 12, color: C.textFaint, marginTop: 4 }}>High Desert Surface Prep</div>
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
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} required />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textFaint, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>Password</div>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle} required />
            </div>
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
            <div style={{ fontSize: 13, color: C.textFaint, marginBottom: 4 }}>Enter your email and we will send you a reset link.</div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textFaint, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>Email</div>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} required />
            </div>
            <button type="submit" disabled={loading} style={btnStyle}>{loading ? "Sending..." : "Send Reset Link"}</button>
            <div style={{ textAlign: "center", marginTop: 4 }}>
              <button type="button" onClick={() => { setMode("login"); setError(null); setMessage(null); }} style={{ background: "none", border: "none", color: C.tealDark, fontSize: 13, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
                Back to sign in
              </button>
            </div>
          </form>
        )}

        {mode === "reset" && (
          <form onSubmit={handleReset} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 13, color: C.textFaint, marginBottom: 4 }}>Enter your new password.</div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textFaint, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>New Password</div>
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} style={inputStyle} required minLength={6} />
            </div>
            <button type="submit" disabled={loading} style={btnStyle}>{loading ? "Updating..." : "Set New Password"}</button>
          </form>
        )}

      </div>
    </div>
  )
}
