import { useState } from 'react'
import { signIn } from '../lib/auth'

// ─── Matches Sales Command design tokens (src/lib/tokens.js) ────────────────
const C = {
  bg:         '#0f0f14',
  surface:    '#16161f',
  border:     '#1e1e30',
  borderHov:  '#2e2e50',
  textPri:    '#e2e2e8',
  textSec:    '#8888aa',
  textMuted:  '#4a4a6a',
  accent:     '#a0f0a0',
  accentDim:  'rgba(160,240,160,0.12)',
  accentBord: 'rgba(160,240,160,0.3)',
  danger:     '#ef4444',
  dangerDim:  'rgba(239,68,68,0.12)',
  dangerBord: 'rgba(239,68,68,0.3)',
}

export default function Login() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await signIn(email.trim(), password)
      // App.jsx auth listener will detect the new session and redirect automatically
    } catch (err) {
      setError(err.message || 'Login failed. Check your email and password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: C.bg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'DM Sans', sans-serif",
      padding: '24px',
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>

        {/* Logo / wordmark */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 8,
          }}>
            <div style={{
              width: 36,
              height: 36,
              borderRadius: 9,
              background: C.accentDim,
              border: `1px solid ${C.accentBord}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
            }}>📋</div>
            <span style={{
              fontFamily: "'DM Mono', monospace",
              fontWeight: 800,
              fontSize: 16,
              color: C.accent,
              letterSpacing: '0.06em',
            }}>SALES COMMAND</span>
          </div>
          <div style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 11,
            color: C.textMuted,
            letterSpacing: '0.1em',
          }}>HDSP · COMMAND SUITE</div>
        </div>

        {/* Card */}
        <div style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: '32px 28px',
        }}>
          <div style={{
            fontSize: 20,
            fontWeight: 800,
            color: C.textPri,
            marginBottom: 6,
          }}>Sign in</div>
          <div style={{
            fontSize: 13,
            color: C.textSec,
            marginBottom: 28,
          }}>Enter your HDSP credentials to continue.</div>

          {/* Error banner */}
          {error && (
            <div style={{
              background: C.dangerDim,
              border: `1px solid ${C.dangerBord}`,
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 13,
              color: C.danger,
              marginBottom: 20,
            }}>{error}</div>
          )}

          {/* Form */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Email */}
            <div>
              <label style={labelStyle}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@hdsp.com"
                autoComplete="email"
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = C.accentBord}
                onBlur={e  => e.target.style.borderColor = C.border}
              />
            </div>

            {/* Password */}
            <div>
              <label style={labelStyle}>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = C.accentBord}
                onBlur={e  => e.target.style.borderColor = C.border}
              />
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={loading || !email || !password}
              style={{
                marginTop: 8,
                width: '100%',
                padding: '12px',
                borderRadius: 9,
                border: `1px solid ${C.accentBord}`,
                background: loading ? C.accentDim : C.accentDim,
                color: C.accent,
                fontFamily: "'DM Mono', monospace",
                fontWeight: 700,
                fontSize: 13,
                letterSpacing: '0.08em',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: (!email || !password) ? 0.45 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              {loading ? 'SIGNING IN…' : 'SIGN IN'}
            </button>

          </div>
        </div>

        {/* Footer note */}
        <div style={{
          textAlign: 'center',
          marginTop: 20,
          fontFamily: "'DM Mono', monospace",
          fontSize: 11,
          color: C.textMuted,
        }}>
          No account? Contact your HDSP administrator.
        </div>

      </div>
    </div>
  )
}

// ─── Shared styles ───────────────────────────────────────────────────────────

const labelStyle = {
  display: 'block',
  fontSize: 11,
  fontWeight: 700,
  fontFamily: "'DM Mono', monospace",
  letterSpacing: '0.08em',
  color: '#8888aa',
  marginBottom: 7,
  textTransform: 'uppercase',
}

const inputStyle = {
  width: '100%',
  padding: '10px 13px',
  background: '#0f0f14',
  border: '1px solid #1e1e30',
  borderRadius: 8,
  color: '#e2e2e8',
  fontSize: 14,
  fontFamily: "'DM Sans', sans-serif",
  outline: 'none',
  transition: 'border-color 0.15s',
  boxSizing: 'border-box',
}
