/**
 * READ-ONLY diagnostics: subscribes to Supabase realtime (postgres_changes on bug_logs, test_runs,
 * archived_runs) for N seconds and prints the subscription status and any events. Writes nothing.
 *   npx tsx tools/rx95-bridge/realtime-check.ts [--seconds=15]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const secs = Number((process.argv.find(a => a.startsWith('--seconds=')) || '=15').split('=')[1]);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env.local'), 'utf8').split('\n').filter(l => l.includes('='))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const channel = client.channel('rx95-realtime-check');
for (const table of ['bug_logs', 'test_runs', 'archived_runs'])
  channel.on('postgres_changes' as any, { event: '*', schema: 'public', table }, (p: any) => console.log(new Date().toISOString(), 'event', table, p.eventType, p.new?.id || p.old?.id || ''));
channel.subscribe((status: string, err?: Error) => console.log(new Date().toISOString(), 'status', status, err?.message || ''));
setTimeout(() => { void client.removeChannel(channel); process.exit(0); }, secs * 1000);
