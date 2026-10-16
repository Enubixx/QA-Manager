/**
 * End-to-end test of the RX95 background worker against the local mock (no live writes, no RX95).
 *
 *   npx tsx tools/rx95-bridge/worker-e2e.ts [--keep] [--real-rx95]
 *
 * Starts mock-supabase.ts + watcher.ts --mode=dev-supabase (--rx95=fake unless --real-rx95) with a fake
 * issues CLI, seeds a realistic day, then checks: refine (row + JSON-only bug), the stale-edit guard,
 * repro match, same-day bundle suggestions, filed confirmation (follow-up / new / bundle / expiry),
 * heartbeat, graceful-restart requeue, worker-owned-columns-only writes, and missing-column degradation.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bugTextSig } from '../../src/utils/bugRefine';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const PORT = 54000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rx95-worker-e2e-'));
const GM = 'plan-1791908761906', PRESS = 'plan-1787946982095', GM_HOT = '8682925';
const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
const MIN = 60_000, HOUR = 3_600_000;

const bug = (id: string, over: Record<string, unknown> = {}) => ({
  id, testRunId: 'run-e2e-1', planId: GM, stepId: 's1', stepTitle: 'Play the sheet music', feature: 'Music Playback (Multimodal)',
  testerName: 'Eric', deviceName: 'GM01', severity: 'medium', title: 'Tap to pause does not work', note: 'Tapping the side does not pause the song',
  timestamp: iso(20 * MIN), formattedTime: '1:00 PM', ...over,
});
const toRow = (b: any) => ({
  id: b.id, test_run_id: b.testRunId, plan_id: b.planId, step_id: b.stepId, step_title: b.stepTitle, feature: b.feature, tester_name: b.testerName,
  device_name: b.deviceName, severity: b.severity, note: b.note, image_url: null, timestamp: b.timestamp, formatted_time: b.formattedTime, title: b.title,
  refined: b.refined ?? null, status: b.status ?? null, filed: b.filed ?? null, repro_matches: null, bundle: null, file_pending: b.filePending ?? null,
});

// --- seed ---
const B = {
  rowA: bug('bug-1792200000001-aaaa'),                                                     // row, needs refine, bundle with rowB
  rowB: bug('bug-1792200000002-bbbb', { testerName: 'Ed', deviceName: 'GM02' }),            // same title -> fake bundle
  jsonOnly: bug('bug-1792200000003-cccc', { title: 'Gemini answers in Korean', note: 'Asked in English, got Korean' }), // only in run JSON
  repro: bug('bug-1792200000004-dddd', { title: 'Gemini cannot read music sheets', note: 'Says it cannot play the sheet music directly', status: "Repro'd Issue" }),
  edit: bug('bug-1792200000005-eeee', { title: 'Echo of let me take a look', note: 'It said let me take a look twice' }),
  follow: bug('bug-1792200000006-ffff', { title: 'SWW while music plays', filePending: { kind: 'follow-up', issueId: '900000002', hotlistId: GM_HOT, openedAt: iso(5 * MIN) } }),
  fresh: bug('bug-1792200000007-gggg', { title: 'Import button needs many presses', filePending: { kind: 'new', hotlistId: GM_HOT, openedAt: iso(5 * MIN) } }),
  expired: bug('bug-1792200000008-hhhh', { title: 'Old pending', filePending: { kind: 'new', hotlistId: GM_HOT, openedAt: iso(25 * HOUR) } }),
  m1: bug('bug-1792200000009-iiii', { title: 'Mega 1', filePending: { kind: 'bundle', hotlistId: GM_HOT, openedAt: iso(5 * MIN), bundleId: 'bun-1' } }),
  m2: bug('bug-1792200000010-jjjj', { title: 'Mega 2', filePending: { kind: 'bundle', hotlistId: GM_HOT, openedAt: iso(5 * MIN), bundleId: 'bun-1' } }),
  old: bug('bug-1792100000011-kkkk', { timestamp: iso(9 * 24 * HOUR), title: 'Ten days old' }),   // outside the 7-day window
  press: bug('bug-1792200000012-llll', { planId: PRESS, title: 'Rerouting chimes play over Gemini', note: 'chimes over answers' }),
};
const rowBugs = [B.rowA, B.rowB, B.repro, B.edit, B.follow, B.fresh, B.expired, B.m1, B.m2, B.old, B.press];
const seed = {
  bug_logs: rowBugs.map(toRow),
  test_runs: [{ id: 'run-e2e-1', plan_id: GM, plan_name: 'GM', status: 'in_progress', bug_logs: [...rowBugs.filter(b => b.planId === GM), B.jsonOnly] }],
  archived_runs: [],
  populated_features: [],
  ai_summary_requests: [{ id: 'rx95-stuck', status: 'working', payload: { kind: 'refine', bugs: [] }, created_at: iso(30 * MIN), updated_at: iso(20 * MIN) }],
  rx95_bundle_suggestions: [],
};
fs.writeFileSync(path.join(TMP, 'seed.json'), JSON.stringify(seed));
const fakeIssues = {
  issues: [
    { id: '900000001', title: '[Gemini on Glasses] Gemini cannot read music sheets', status: 'NEW', priority: 'P2', hotlistIds: [GM_HOT], description: 'Gemini states it cannot play the sheet music directly.', created: iso(48 * HOUR), updates: [] },
    { id: '900000002', title: '[Gemini on Glasses] SWW error spoken despite music playback', status: 'NEW', priority: 'P2', hotlistIds: [GM_HOT], description: 'SWW while YTM plays', created: iso(48 * HOUR),
      updates: [{ at: iso(2 * MIN), by: 'qa@google.com', comment: `Reproduced in QA field testing. QA Manager ${B.follow.id}` }] },
    { id: '900000003', title: '[Gemini on Glasses] [Video Capture] Import button needs many presses', status: 'NEW', priority: 'P2', hotlistIds: [GM_HOT], description: `... _QA Manager ${B.fresh.id}_`, created: iso(3 * MIN) },
    { id: '900000004', title: '[Gemini on Glasses] [Music] Mega bug (reported 2×)', status: 'NEW', priority: 'P2', hotlistIds: [GM_HOT], description: `reports: ${B.m1.id}, ${B.m2.id}`, created: iso(2 * MIN) },
    { id: '900000005', title: '[Gemini on Glasses] Closed obsolete thing', status: 'OBSOLETE', priority: 'P2', hotlistIds: [GM_HOT], description: 'sheet music obsolete', created: iso(72 * HOUR) },
  ],
};
fs.writeFileSync(path.join(TMP, 'issues.json'), JSON.stringify(fakeIssues));

// --- processes ---
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
const api = async (p: string, init?: RequestInit) => { const t = await (await fetch(`${BASE}${p}`, init)).text(); return t ? JSON.parse(t) : null; };
const rows = async () => (await api('/__admin/state')).tables;
const bugRow = async (id: string) => (await rows()).bug_logs.rows.find((r: any) => r.id === id);
async function waitFor<T>(what: string, fn: () => Promise<T | undefined | false | null>, ms = 60_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn().catch(() => undefined); if (v) return v as T; await sleep(500); }
  throw new Error(`timeout waiting for ${what}`);
}
const results: Array<[string, boolean, string?]> = [];
const check = (name: string, cond: boolean, detail = '') => { results.push([name, cond, detail]); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

async function main() {
  run('mock', ['tools/rx95-bridge/mock-supabase.ts', `--port=${PORT}`, `--seed=${path.join(TMP, 'seed.json')}`]);
  await waitFor('mock', async () => (await fetch(`${BASE}/__admin/state`)).ok, 30_000);
  const env = {
    RX95_SUPABASE_URL: BASE, RX95_ISSUES_CLI: path.join(HERE, 'fake-issues-cli.mjs'), FAKE_ISSUES_FILE: path.join(TMP, 'issues.json'),
    RX95_WORKER_SWEEP_MS: '4000', RX95_WORKER_HEARTBEAT_MS: '3000', RX95_WORKER_CONFIRM_MS: '3000', RX95_WORKER_COALESCE_MS: '1000',
    RX95_FAKE_DELAY_MS: '2500', RX95_DESC_CACHE_FILE: path.join(TMP, 'desc-cache.json'), RX95_ARCHIVE_CHATS: '1',
  };
  run('bridge', ['tools/rx95-bridge/watcher.ts', '--mode=dev-supabase', '--requests=off', ...(args.has('--real-rx95') ? [] : ['--rx95=fake'])], env);

  // graceful restart: the stuck 'working' request goes back to pending
  const stuck = await waitFor('requeue', async () => { const r = (await rows()).ai_summary_requests.rows[0]; return r.status === 'pending' && r; }, 30_000).catch(() => null);
  check('stuck working request re-queued on start', !!stuck);

  // stale-edit guard: edit B.edit while its refine is in flight (fake RX95 takes 2.5 s)
  await waitFor('refine running', async () => logs.some(l => /refine/.test(l) && /started|written/.test(l)) || (await bugRow(B.rowA.id))?.refined, 30_000).catch(() => null);
  const edited = { ...toRow(B.edit), note: 'EDITED: it echoed three times' };
  await api(`/rest/v1/bug_logs?id=eq.${B.edit.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note: edited.note }) });

  const a = await waitFor('refine rowA', async () => (await bugRow(B.rowA.id))?.refined, 60_000).catch(() => null);
  check('refine written to an existing row', !!a && a.sig === bugTextSig(B.rowA as any), a ? a.title : 'none');
  const j = await waitFor('json-only row', async () => (await bugRow(B.jsonOnly.id)), 60_000).catch(() => null);
  check('JSON-only bug got a minimal row with refine', !!j?.refined && j.note === B.jsonOnly.note && j.plan_id === GM, j ? `note kept, refined=${!!j.refined}` : 'none');
  const e = await waitFor('edited refine', async () => { const r = await bugRow(B.edit.id); return r?.refined && r.refined.sig === bugTextSig({ title: B.edit.title, note: edited.note } as any) && r; }, 60_000).catch(() => null);
  check('edit mid-refine: stale result dropped, re-refined on new text', !!e && e.note === edited.note);
  const old = await bugRow(B.old.id);
  check('bugs older than 7 days are left alone', !old?.refined);

  const rm = await waitFor('repro matches', async () => (await bugRow(B.repro.id))?.repro_matches, 60_000).catch(() => null);
  check('repro match written for Repro\'d bug', !!rm && rm.hotlistId === GM_HOT && rm.candidates?.[0]?.id === '900000001' && rm.sig === bugTextSig(B.repro as any), rm ? `${rm.candidates?.length} cand, searched ${rm.searched}` : 'none');
  check('closed (OBSOLETE) bugs never offered', !!rm && !rm.candidates.some((c: any) => c.id === '900000005') && rm.searched === 4);

  const sug = await waitFor('bundle suggestions', async () => (await rows()).rx95_bundle_suggestions.rows.find((r: any) => r.id.startsWith(GM) && r.payload?.suggestions?.length), 90_000).catch(() => null);
  const s0 = sug?.payload?.suggestions?.[0];
  check('same-day bundle suggestion written', !!s0 && s0.memberIds.includes(B.rowA.id) && s0.memberIds.includes(B.rowB.id), s0 ? `${s0.title} [${s0.memberIds.length}]` : 'none');
  check('bundle excludes Repro\'d / pending / filed reports', !!s0 && ![B.repro.id, B.follow.id, B.fresh.id].some(id => s0.memberIds.includes(id)));

  const f1 = await waitFor('follow-up confirmed', async () => { const r = await bugRow(B.follow.id); return r?.filed?.confirmed && r; }, 60_000).catch(() => null);
  check('follow-up confirmed from issue comment', !!f1 && f1.filed.issueId === '900000002' && f1.filed.via === 'follow-up' && f1.file_pending === null);
  const f2 = await waitFor('new confirmed', async () => { const r = await bugRow(B.fresh.id); return r?.filed?.confirmed && r; }, 60_000).catch(() => null);
  check('new bug confirmed + b/ number filled in', !!f2 && f2.filed.issueId === '900000003' && f2.filed.via === 'new' && f2.file_pending === null);
  const m = await waitFor('bundle confirmed', async () => { const r1 = await bugRow(B.m1.id), r2 = await bugRow(B.m2.id); return r1?.filed?.confirmed && r2?.filed?.confirmed && [r1, r2]; }, 60_000).catch(() => null);
  check('mega bug confirmed for every member', !!m && m.every((r: any) => r.filed.issueId === '900000004' && r.filed.via === 'bundle'));
  const x = await waitFor('expired', async () => { const r = await bugRow(B.expired.id); return r?.file_pending?.expired && r; }, 60_000).catch(() => null);
  check('pending older than 24h marked expired', !!x && !x.filed);

  const hb = await waitFor('heartbeat', async () => (await rows()).rx95_bundle_suggestions.rows.find((r: any) => r.id === '_heartbeat'), 30_000).catch(() => null);
  check('heartbeat row', !!hb && Date.now() - Date.parse(hb.payload.at) < 15_000 && typeof hb.payload.queues?.refine === 'number', hb ? JSON.stringify(hb.payload.queues) : 'none');

  // worker-owned columns only
  const wlog: any[] = await api('/__admin/log');
  const ownedCols = new Set(['refined', 'repro_matches', 'filed', 'file_pending', 'bundle']);
  const badPatch = wlog.filter(w => w.method === 'PATCH' && w.table === 'bug_logs' && Object.keys(w.body || {}).some(k => !ownedCols.has(k) && !(k === 'note' && w.ids?.[0] === B.edit.id)));
  check('worker PATCHes only its own bug_logs columns', badPatch.length === 0, badPatch.length ? JSON.stringify(badPatch[0]).slice(0, 200) : '');
  const inserts = wlog.filter(w => w.method === 'POST' && w.table === 'bug_logs');
  check('minimal-row inserts use ignore-duplicates and only for JSON-only bugs', inserts.every(w => /ignore-duplicates/.test(w.prefer) && w.ids.every((id: string) => id === B.jsonOnly.id)), `${inserts.length} insert(s)`);
  const runWrites = wlog.filter(w => ['test_runs', 'archived_runs'].includes(w.table));
  check('run JSON never written', runWrites.length === 0);

  // load: a burst of 50 step taps (run results change, bug JSON doesn't) must not trigger reloads
  await sleep(3000);
  await api('/__admin/stats/reset', { method: 'POST' });
  for (let i = 0; i < 50; i++) {
    await api(`/rest/v1/test_runs?id=eq.run-e2e-1`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ results: { [`step-${i}`]: { status: 'green', timestamp: new Date().toISOString() } }, current_step_index: i }) });
    await sleep(40);
  }
  await sleep(6000);
  const st: Record<string, { requests: number; bytesOut: number }> = await api('/__admin/stats');
  const gets = Object.entries(st).filter(([k]) => k.startsWith('GET '));
  const getReq = gets.reduce((n, [, v]) => n + v.requests, 0);
  const getBytes = gets.reduce((n, [, v]) => n + v.bytesOut, 0);
  check('50 step taps: coalesced, no full reload (<=3 GETs, <20 KB read)', getReq <= 3 && getBytes < 20_000 && !st['GET bug_logs'], `${getReq} GET(s), ${getBytes} bytes: ${JSON.stringify(Object.fromEntries(gets))}`);

  // degradation: drop file_pending + the suggestions table; worker must keep refining and not crash
  await api('/__admin/schema', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ table: 'bug_logs', drop: ['file_pending'] }) });
  await api('/__admin/schema', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ table: 'rx95_bundle_suggestions', dropTable: true }) });
  const newBug = bug('bug-1792200000099-zzzz', { title: 'New after schema change', note: 'still refined?' });
  await api('/rest/v1/bug_logs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify((({ file_pending, ...r }) => r)(toRow(newBug) as any)) });
  const nb = await waitFor('refine after schema drop', async () => (await bugRow(newBug.id))?.refined, 60_000).catch(() => null);
  check('missing column/table: other jobs keep running', !!nb);
  await sleep(9000);
  const warnLines = logs.filter(l => /missing/.test(l));
  const repeated = warnLines.length > 6;
  check('missing schema logged once (no retry spam)', !repeated, `${warnLines.length} warning line(s)`);
  check('bridge still alive', procs[1].exitCode === null);
}

main()
  .catch(e => { console.error('E2E error:', e.message); results.push(['e2e', false, e.message]); })
  .finally(() => {
    const failed = results.filter(r => !r[1]);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed. Logs: ${path.join(TMP, 'e2e.log')}`);
    fs.writeFileSync(path.join(TMP, 'e2e.log'), logs.join('\n'));
    if (!args.has('--keep')) procs.forEach(p => p.kill('SIGTERM'));
    else console.log(`kept running: mock ${BASE}`);
    setTimeout(() => process.exit(failed.length ? 1 : 0), 500);
  });
