import { createClient } from '@supabase/supabase-js';

const env = (import.meta as any).env || {};
const supabaseUrl = env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/**
 * Postgres rejects NUL (\u0000) inside text/jsonb ("unsupported Unicode escape sequence"), which
 * made whole run/bug saves fail when an older fingerprint containing NUL rode along. Every request
 * body is scrubbed (\u0000 -> \u001f, the separator fingerprints use now) before it leaves.
 */
export const scrubNul = (body: unknown) =>
  typeof body === 'string' && body.includes('\\u0000') ? body.replace(/(?<!\\)((?:\\\\)*)\\u0000/g, '$1\\u001f') : body;
const scrubbingFetch: typeof fetch = (input, init) =>
  fetch(input, init && init.body !== undefined ? { ...init, body: scrubNul(init.body) as BodyInit } : init);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, { global: { fetch: scrubbingFetch } })
  : null;
