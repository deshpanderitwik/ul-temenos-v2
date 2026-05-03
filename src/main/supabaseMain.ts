import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { app } from 'electron'

const REFRESH_MARGIN_MS = 60_000

let client: SupabaseClient | null = null

function loadEnv(): Record<string, string> {
  const vars: Record<string, string> = {}
  try {
    const envPath = resolve(app.getAppPath(), '.env')
    const content = readFileSync(envPath, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      vars[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim()
    }
  } catch {
    // .env not found
  }
  return vars
}

function getEnvVar(
  keys: string | string[],
  env: Record<string, string>
): string | undefined {
  const candidates = Array.isArray(keys) ? keys : [keys]
  for (const k of candidates) {
    const v = process.env[k] ?? env[k]
    if (v) return v
  }
  return undefined
}

export function getSupabaseClient(): SupabaseClient | null {
  if (client) return client

  const env = loadEnv()
  const url = getEnvVar(['SUPABASE_URL', 'VITE_SUPABASE_URL'], env)
  const anonKey = getEnvVar(
    ['SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY'],
    env
  )

  if (!url || !anonKey) return null

  client = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: false
    }
  })

  client.auth.onAuthStateChange((event) => {
    console.log('[supabase] auth event:', event)
  })

  return client
}

async function signInFromEnv(sb: SupabaseClient): Promise<boolean> {
  const env = loadEnv()
  // Prefer non-VITE_ names for credentials so they can never be inlined
  // into the renderer bundle by Vite. The VITE_-prefixed forms remain
  // accepted for backward compatibility with older .env files.
  const email = getEnvVar(
    ['SUPABASE_USER_EMAIL', 'VITE_SUPABASE_USER_EMAIL'],
    env
  )
  const password = getEnvVar(
    ['SUPABASE_USER_PASSWORD', 'VITE_SUPABASE_USER_PASSWORD'],
    env
  )
  if (!email || !password) {
    console.error('[supabase] no credentials in env')
    return false
  }
  const { error } = await sb.auth.signInWithPassword({ email, password })
  if (error) {
    console.error('[supabase] sign-in failed:', error.message)
    return false
  }
  return true
}

export async function ensureAuthenticated(): Promise<SupabaseClient | null> {
  const sb = getSupabaseClient()
  if (!sb) return null

  const { data: { session } } = await sb.auth.getSession()

  if (session?.expires_at && session.expires_at * 1000 > Date.now() + REFRESH_MARGIN_MS) {
    return sb
  }

  if (session) {
    const { data, error } = await sb.auth.refreshSession()
    if (!error && data.session) return sb
    console.warn('[supabase] refresh failed, will re-sign-in:', error?.message)
  }

  const ok = await signInFromEnv(sb)
  return ok ? sb : null
}
