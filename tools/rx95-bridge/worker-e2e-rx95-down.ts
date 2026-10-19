/**
 * E2E: RX95 cleanup replies keep failing (the 2026-10-19 stall) -> bundle checks must still run, and the
 * heartbeat must report the failures so the app can warn. Local mock only (no live writes, no RX95).
 *
 *   npx tsx tools/rx95-bridge/worker-e2e-rx95-down.ts [--verbose]
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const PORT = 55000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rx95-down-e2e-'));
const PLAN = 'plan-1787855820482';
const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
const MIN = 60_000;

// Six unrefined reports on one plan-day: lots of failing cleanup work, and 2 identical reports to bundle
const bug = (n: number, title: string) => ({
  id: `bug-17924000000${String(n).padStart(2, '0')}-dn${n}x`, test_run_id: 'run-down-1', plan_id: PLAN, step_id: `s${n}`, step_title: `Step ${n}`,
  feature: n % 2 ? 'Google Keep' : 'Google Calendar', tester_name: 'Amy H', device_name: 'WP04', severity: 'medium', note: `${title} (details ${n})`,
  image_url: null, timestamp: iso((30 - n) * MIN), formatted_time: '11:00 AM', title, refined: null, status: 'New', filed: null, repro_matches: null, bundle: null, file_pending: null,
});
const reports = [
  bug(1, 'Cannot access Dynamic Camera'), bug(2, 'Cannot access Dynamic Camera'),
  bug(3, 'Echo of let me take a look'), bug(4, 'Gemini answers in French'), bug(5, 'Keep note not saved'), bug(6, 'Calendar event wrong time'),
];
const seed = {
  bug_logs: reports,
  test_runs: [{ id: 'run-down-1', plan_id: PLAN, plan_name: 'Warby', status: 'in_progress', bug_logs: [] }],
  archived_runs: [], populated_features: [], ai_summary_requests: [], rx95_bundle_suggestions: [],
};
fs.writeFileSync(path.join(TMP, 'seed.json'), JSON.stringify(seed));
fs.writeFileSync(path.join(TMP, 'issues.json'), JSON.stringify({ issues: [] }));

const procs: ChildProcess[] = [];
const logs: string[] = [];
function run(name: string, argv: string[], env: Record<string, string> = {}) {
  const p = spawn('npx', ['tsx', ...argv], { cwd: path.resolve(HERE, '../..'), env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const onData = (d: Buffer) => String(d).split('\n').filter(Boolean).forEach(l => { logs.push(`[${name}] ${l}`); if (args.has('--verbose')) console.log(`[${name}] ${l}`); });
  p.stdout!.on('data', onData); p.stderr!.on('data', onData);
  procs.push(p);
  return p;
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const api = async (p: string) => { const t = await (await fetch(`${BASE}${p}`)).text(); return t ? JSON.parse(t) : null; };
const rows = async () => (await api('/__admin/state')).tables;
async function waitFor<T>(what: string, fn: () => Promise<T | undefined | false | null>, ms = 60_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn().catch(() => undefined); if (v) return v as T; await sleep(500); }
  throw new Error(`timeout waiting for ${what}`);
}
const results: Array<[string, boolean, string?]> = [];
const check = (name: string, cond: boolean, detail = '') => { results.push([name, cond, detail]); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

async function startBridge(extra: Record<string, string>) {
  run('bridge', ['tools/rx95-bridge/watcher.ts', '--mode=dev-supabase', '--requests=off', '--rx95=fake'], {
    RX95_SUPABASE_URL: BASE, RX95_ISSUES_CLI: path.join(HERE, 'fake-issues-cli.mjs'), FAKE_ISSUES_FILE: path.join(TMP, 'issues.json'),
    RX95_WORKER_SWEEP_MS: '3000', RX95_WORKER_HEARTBEAT_MS: '2000', RX95_WORKER_CONFIRM_MS: '60000', RX95_WORKER_COALESCE_MS: '1000',
    RX95_FAKE_DELAY_MS: '3000', RX95_FAKE_REFINE_DOWN: '1', RX95_BUNDLE_WAIT_FOR_REFINE_MS: '8000', RX95_BUNDLE_QUIET_MS: '3000', RX95_BUNDLE_MAX_WAIT_MS: '15000',
    RX95_DESC_CACHE_FILE: path.join(TMP, 'desc-cache.json'), RX95_ARCHIVE_CHATS: '0', ...extra,
  });
}
const heartbeatRow = async () => (await rows()).rx95_bundle_suggestions.rows.find((x: any) => x.id === '_heartbeat');

async function main() {
  run('mock', ['tools/rx95-bridge/mock-supabase.ts', `--port=${PORT}`, `--seed=${path.join(TMP, 'seed.json')}`]);
  await waitFor('mock', async () => (await fetch(`${BASE}/__admin/state`)).ok, 30_000);

  // Phase 1: cleanup replies fail, bundle replies work -> the bundle check must not be starved
  const t0 = Date.now();
  startBridge({});
  let sawFailing: any = null;
  const sug = await waitFor('bundle suggestion', async () => {
    const hb = await heartbeatRow();
    if (!sawFailing && hb?.payload?.rx95?.failStreak >= 1) sawFailing = hb.payload.rx95;
    return (await rows()).rx95_bundle_suggestions.rows.find((r: any) => r.id.startsWith(PLAN) && r.payload?.suggestions?.length);
  }, 90_000).catch(() => null);
  const s0 = sug?.payload?.suggestions?.[0];
  const secs = Math.round((Date.now() - t0) / 1000);
  check('bundle suggestion still written while every cleanup fails', !!s0 && s0.memberIds.includes(reports[0].id) && s0.memberIds.includes(reports[1].id), s0 ? `${s0.memberIds.length} members after ${secs}s` : 'none');
  check('bundles not starved behind failing cleanups (< 45 s)', !!s0 && secs < 45, `${secs}s`);
  check('heartbeat showed the cleanup failure', !!sawFailing && /did not reply/.test(sawFailing.error), JSON.stringify(sawFailing));
  const hbOk = await waitFor('heartbeat ok', async () => { const hb = await heartbeatRow(); return hb?.payload?.rx95?.failStreak === 0 && hb?.payload?.rx95?.okAt && hb; }, 15_000).catch(() => null);
  check('a successful RX95 reply resets the failure count', !!hbOk, hbOk ? JSON.stringify(hbOk.payload.rx95) : 'none');
  check('worker logged the failures', logs.some(l => /job refine:.*failed: RX95 did not reply/.test(l)));
  check('no cleanup written (RX95 down)', !(await rows()).bug_logs.rows.some((r: any) => r.refined));
  check('bridge still alive', procs[1].exitCode === null);

  // Phase 2: RX95 fully down (cleanup + bundle) -> heartbeat reports a stall (app shows "RX95 not responding")
  procs[1].kill('SIGTERM');
  await sleep(1500);
  await fetch(`${BASE}/rest/v1/bug_logs?id=eq.${reports[2].id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Cannot access Dynamic Camera', note: 'Same camera failure again' }) });
  startBridge({ RX95_FAKE_BUNDLE_DOWN: '1' });
  const hbStall = await waitFor('stalled heartbeat', async () => { const hb = await heartbeatRow(); return hb?.payload?.rx95?.failStreak >= 2 && hb; }, 90_000).catch(() => null);
  const r = hbStall?.payload?.rx95;
  check('RX95 fully down: heartbeat failStreak >= 2 with no success since', !!r && !!r.failAt && (!r.okAt || r.failAt > r.okAt), r ? JSON.stringify(r) : 'none');
  check('bridge (restarted) still alive', procs[2].exitCode === null);
}

main()
  .catch(e => { console.error('E2E error:', e.message); results.push(['e2e', false, e.message]); })
  .finally(() => {
    const failed = results.filter(r => !r[1]);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed. Logs: ${path.join(TMP, 'e2e.log')}`);
    fs.writeFileSync(path.join(TMP, 'e2e.log'), logs.join('\n'));
    procs.forEach(p => p.kill('SIGTERM'));
    setTimeout(() => process.exit(failed.length ? 1 : 0), 500);
  });
