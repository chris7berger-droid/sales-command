import { supabase } from './supabase'

// ─── Session ────────────────────────────────────────────────────────────────

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

export function onAuthStateChange(callback) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session)
  })
  return subscription // call subscription.unsubscribe() on cleanup
}

// ─── Sign in / out ──────────────────────────────────────────────────────────

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data.session
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

// ─── Current team member record ─────────────────────────────────────────────
// Joins auth.users → team_members via auth_id.
// Returns null if no matching team_members row (user exists in auth but not yet linked).

export async function getCurrentTeamMember() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('team_members')
    .select('id, name, role, email')
    .eq('auth_id', user.id)
    .single()

  if (error) return null
  return data
}
