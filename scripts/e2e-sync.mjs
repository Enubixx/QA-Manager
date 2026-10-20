#!/usr/bin/env node
/**
 * Multi-client sync E2E: two dashboards (separate browser contexts = separate localStorage) against the
 * local mock Supabase (tools/rx95-bridge/mock-supabase.ts). Never talks to production.
 *
 *   npm run test:e2e:sync                       # app from this checkout
 *   npm run test:e2e:sync -- --app-root=/tmp/qa-main   # app from another checkout (e.g. a main worktree)
 *   npm run test:e2e:sync -- --only=1a,3 --headful --verbose
 *
 * Cases:
 *   1a/1b  A activates WP01, B activates GM01 0.3 s / 2 s later -> both stay active 20 s (A, B, cloud)
 *   2      A edits WP02's quota, a stale B saves an unrelated change (GM02 -> Maintenance) -> quota sticks
 *   3      A deletes DEL1; B saves (stale) during and after the undo window -> DEL1 stays deleted, also after reload
 *   4      A deletes a bug that is also embedded in an archived run -> gone 20 s later in A, B and cloud
 *   5      a live run on one of two devices named DUP1 locks only that device
 *   6      Floor Ready/Maintenance toggle + quota edits from both clients stick
 *   7a-7d  Undo (toast, within 10 s) of a deleted device / tester / bug embedded in a run / whole run brings it back
 *          in A, B and the cloud (tombstone cleared, rows + embedded copies back) and it stays
 *   8a-8d  same via Recently deleted -> Restore after the 10 s window
 * Exit code 0 = all passed.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.join('=') || 'true'];
}));
const APP_ROOT = path.resolve(argv['app-root'] || REPO);
const ONLY = argv.only ? new Set(String(argv.only).split(',')) : null;
const VERBOSE = !!argv.verbose;
const HOLD_MS = Number(argv.hold || 20000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const t0 = Date.now();
const ts = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's';
const log = (...a) => console.log(ts(), ...a);
const vlog = (...a) => VERBOSE && log(...a);

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}
async function waitFor(url, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.status < 500) return; } catch {}
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${url}`);
}
function localDate(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------- seed ----------
const PLAN = { id: 'plan-1', name: 'Press QA Plan', description: '', steps: [{ id: 's1', title: 'Step 1', feature: 'Spotify' }, { id: 's2', title: 'Step 2', feature: 'Photo Capture' }], created_at: '2026-10-01T00:00:00Z' };
const q = (n = 2) => [{ planId: 'plan-1', targetRunsPerDay: n }];
function seedFor(devices, extra = {}) {
  return {
    test_plans: [PLAN],
    populated_features: [
      { feature_name: '__GLOBAL_DEVICES_CONFIG__:' + JSON.stringify(devices) },
      { feature_name: '__GLOBAL_TESTERS_CONFIG__:' + JSON.stringify([{ id: 't1', name: 'Amy H' }, { id: 't2', name: 'Bo K' }]) },
      { feature_name: '__DAILY_QUOTA_RESET_DATE__:' + localDate() },
      { feature_name: 'Spotify' },
    ],
    test_runs: [], archived_runs: [], bug_logs: [],
    ...extra,
  };
}
const BASE_DEVICES = () => [
  { id: 'dev-100', name: 'WP01', isReady: true, quotas: [] },
  { id: 'dev-200', name: 'GM01', isReady: true, quotas: [] },
  { id: 'dev-300', name: 'WP02', isReady: true, quotas: q(2) },
  { id: 'dev-400', name: 'GM02', isReady: true, quotas: q(2) },
];

// ---------- servers ----------
let mockProc, viteProc, MOCK, APP, browser;
async function startServers() {
  const mockPort = await freePort();
  const appPort = await freePort();
  MOCK = `http://127.0.0.1:${mockPort}`;
  APP = `http://127.0.0.1:${appPort}/`;
  const seedFile = path.join(os.tmpdir(), `e2e-sync-seed-${process.pid}.json`);
  fs.writeFileSync(seedFile, JSON.stringify(seedFor(BASE_DEVICES())));
  mockProc = spawn('npx', ['--no-install', 'tsx', path.join(REPO, 'tools/rx95-bridge/mock-supabase.ts'), `--port=${mockPort}`, `--seed=${seedFile}`], { cwd: REPO, stdio: 'pipe', detached: true });
  viteProc = spawn('npx', ['--no-install', 'vite', '--port', String(appPort), '--strictPort', '--host', '127.0.0.1'], {
    cwd: APP_ROOT, stdio: 'pipe', detached: true,
    env: { ...process.env, VITE_SUPABASE_URL: MOCK, VITE_SUPABASE_ANON_KEY: 'mockkey', VITE_GEMINI_API_KEY: '', VITE_GOOGLE_SCRIPT_URL: '', VITE_RX95_BRIDGE_URL: '', VITE_PROTOTYPE_SEED_URL: '' },
  });
  for (const [n, p] of [['mock', mockProc], ['vite', viteProc]]) p.stderr.on('data', d => vlog(`[${n}]`, String(d).trim().slice(0, 300)));
  await waitFor(`${MOCK}/__admin/stats`);
  await waitFor(APP);
  log(`mock ${MOCK} · app ${APP} (from ${APP_ROOT})`);
}
function stopServers() {
  for (const p of [viteProc, mockProc]) { try { process.kill(-p.pid, 'SIGTERM'); } catch {} }
}

// ---------- cloud view ----------
async function cloudState() { return (await (await fetch(`${MOCK}/__admin/state`)).json()).tables; }
function collectIds(v, out = new Set()) {
  if (typeof v === 'string') out.add(v);
  else if (Array.isArray(v)) v.forEach(x => collectIds(x, out));
  else if (v && typeof v === 'object') {
    if (typeof v.id === 'string') out.add(v.id);
    for (const k of ['ids', 'deletedIds', 'items', 'list']) if (v[k]) collectIds(v[k], out);
  }
  return out;
}
function prefixed(tables, prefix) {
  return (tables.populated_features?.rows || []).map(r => r.feature_name).filter(n => n?.startsWith(prefix)).map(n => {
    try { return JSON.parse(n.slice(prefix.length)); } catch { return null; }
  }).filter(Boolean);
}
async function cloudDevices() {
  const t = await cloudState();
  const deleted = new Set();
  for (const p of prefixed(t, '__GLOBAL_DELETED_DEVICES__:')) collectIds(p, deleted);
  const payloads = prefixed(t, '__GLOBAL_DEVICES_CONFIG__:');
  const list = [];
  for (const p of payloads) {
    const arr = Array.isArray(p) ? p : p.devices || p.list || [];
    if (!Array.isArray(p) && p.deletedIds) collectIds(p.deletedIds, deleted);
    list.push(...arr);
  }
  return list.filter(d => d && !deleted.has(d.id));
}
async function cloudTesters() {
  const t = await cloudState();
  const deleted = new Set();
  for (const p of prefixed(t, '__GLOBAL_DELETED_TESTERS__:')) collectIds(p, deleted);
  const list = [];
  for (const p of prefixed(t, '__GLOBAL_TESTERS_CONFIG__:')) {
    if (!Array.isArray(p) && p.deletedIds) collectIds(p.deletedIds, deleted);
    list.push(...(Array.isArray(p) ? p : p.testers || p.list || []));
  }
  return list.filter(x => x && !deleted.has(x.id));
}
async function cloudBugPresent(bugId) {
  const t = await cloudState();
  const tomb = new Set();
  for (const p of prefixed(t, '__GLOBAL_DELETED_BUGS__:')) collectIds(p, tomb);
  if ((t.bug_logs?.rows || []).some(r => r.id === bugId)) return 'bug_logs row';
  for (const tn of ['test_runs', 'archived_runs']) {
    for (const r of t[tn]?.rows || []) {
      let bl = r.bug_logs;
      if (typeof bl === 'string') { try { bl = JSON.parse(bl); } catch { bl = []; } }
      if (Array.isArray(bl) && bl.some(b => b?.id === bugId) && !tomb.has(bugId)) return `embedded in ${tn}/${r.id}`;
    }
  }
  return '';
}

// ---------- client helpers ----------
async function openClient(label) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept().catch(() => {}));
  page.on('pageerror', e => vlog(`[${label} pageerror]`, String(e).slice(0, 200)));
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('[data-testid="nav-tab-floor"]', { timeout: 120000 });
  await sleep(2500);
  await gotoTab(page, 'floor');
  return { ctx, page, label };
}
async function gotoTab(page, tab) {
  await page.evaluate(t => document.querySelector(`[data-testid="nav-tab-${t}"]`)?.click(), tab);
  await sleep(1200);
}
async function clientDevices(page) {
  return page.evaluate(() => { try { return JSON.parse(localStorage.getItem('qa_devices_list') || '[]'); } catch { return []; } });
}
const isActive = d => !!(d && Array.isArray(d.quotas) && d.quotas.some(x => Number(x.targetRunsPerDay) > 0));
const quotaOf = d => (d?.quotas || []).find(x => Number(x.targetRunsPerDay) > 0)?.targetRunsPerDay ?? 0;

/** Pick a device in whichever activation select offers it (start-of-day row or the "+ Activate device" tile) and click Activate. */
async function activate(page, devId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const picked = await page.evaluate(id => {
      const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === id) && ![...s.options].some(o => /^\d{4}-\d{2}-\d{2}$/.test(o.value)));
      if (!sel) return false;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, id);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, devId);
    if (picked) {
      await sleep(200);
      const clicked = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find(x => /^(＋\s*)?Activate$/.test((x.textContent || '').trim()) && !x.disabled);
        b?.click();
        return !!b;
      });
      if (clicked) return;
    }
    await page.evaluate(() => [...document.querySelectorAll('button')].find(x => /Activate device/.test(x.textContent || ''))?.click());
    await sleep(400);
  }
  throw new Error(`SETUP: could not activate ${devId}`);
}
/** Open the Floor inspector drawer for the tile with this name (nth duplicate). */
async function openTile(page, name, nth = 0) {
  const ok = await page.evaluate((n, i) => {
    const spans = [...document.querySelectorAll('span.font-mono.font-bold')].filter(s => s.textContent.trim() === n && s.closest('div.cursor-pointer'));
    const s = spans[i];
    s?.closest('div.cursor-pointer').click();
    return !!s;
  }, name, nth);
  if (!ok) throw new Error(`SETUP: tile ${name} not found`);
  await sleep(300);
}
async function closeDrawer(page) {
  await page.evaluate(() => document.querySelector('button[title="Close (Esc)"]')?.click());
  await sleep(150);
}
async function toggleReady(page) {
  const ok = await page.evaluate(() => {
    const drawer = document.querySelector('button[title="Close (Esc)"]')?.closest('div.fixed');
    const b = drawer && [...drawer.querySelectorAll('button')].find(x => /^(Ready|Maintenance)$/.test(x.textContent.trim()));
    b?.click();
    return !!b;
  });
  if (!ok) throw new Error('SETUP: Ready/Maintenance toggle not found');
}
async function setQuota(page, n) {
  const ok = await page.evaluate(v => {
    const i = document.querySelector('input[title="Daily quota"]');
    if (!i) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, String(v));
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, n);
  if (!ok) throw new Error('SETUP: quota input not found');
}
async function deleteOpenDevice(page, name) {
  const ok = await page.evaluate(n => { const b = document.querySelector(`button[title="Delete ${n}"]`); b?.click(); return !!b; }, name);
  if (!ok) throw new Error(`SETUP: delete button for ${name} not found`);
}
async function tileCount(page, name) {
  return page.evaluate(n => [...document.querySelectorAll('span.font-mono.font-bold')].filter(s => s.textContent.trim() === n && s.closest('div.cursor-pointer')).length, name);
}

/**
 * Wait (up to convergeMs) until check() returns no problems, then require it to keep returning none for holdMs.
 * check() returns a list of problem strings.
 */
async function holds(check, { convergeMs = 10000, holdMs = HOLD_MS, every = 1000 } = {}) {
  const cEnd = Date.now() + convergeMs;
  let probs = await check();
  while (probs.length && Date.now() < cEnd) { await sleep(500); probs = await check(); }
  if (probs.length) return `never converged within ${convergeMs / 1000}s: ${probs.join('; ')}`;
  const hEnd = Date.now() + holdMs;
  while (Date.now() < hEnd) {
    await sleep(every);
    probs = await check();
    if (probs.length) return `reverted after ${((holdMs - (hEnd - Date.now())) / 1000).toFixed(1)}s: ${probs.join('; ')}`;
  }
  return '';
}

async function deviceViews(clients) {
  const views = { cloud: await cloudDevices() };
  for (const c of clients) views[c.label] = await clientDevices(c.page);
  return views;
}
function expectDevices(views, expectations) {
  const probs = [];
  for (const [where, list] of Object.entries(views)) {
    for (const [id, fn, desc] of expectations) {
      const d = list.find(x => x.id === id);
      const why = fn(d);
      if (why !== true) probs.push(`${where}: ${desc} (${why || 'got ' + JSON.stringify(d ? { name: d.name, isReady: d.isReady, quotas: d.quotas, activeTesterName: d.activeTesterName } : null)})`);
    }
  }
  return probs;
}

// ---------- cases ----------
async function withClients(seed, fn) {
  await fetch(`${MOCK}/__admin/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seed }) });
  const A = await openClient('A');
  const B = await openClient('B');
  try { return await fn(A, B); } finally { await A.ctx.close().catch(() => {}); await B.ctx.close().catch(() => {}); }
}

async function waitLocal(c, id, fn, what, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn((await clientDevices(c.page)).find(d => d.id === id))) return;
    await sleep(100);
  }
  throw new Error(`SETUP: ${c.label} never showed ${what} locally`);
}

async function caseConcurrentActivate(gapMs) {
  return withClients(seedFor(BASE_DEVICES()), async (A, B) => {
    await activate(A.page, 'dev-100');
    const tA = Date.now();
    await waitLocal(A, 'dev-100', isActive, 'WP01 active', 1500);
    log(`  A activated WP01; B activates GM01 ${gapMs / 1000}s later`);
    await sleep(Math.max(0, gapMs - (Date.now() - tA)));
    await activate(B.page, 'dev-200');
    await waitLocal(B, 'dev-200', isActive, 'GM01 active', 1500);
    return holds(async () => expectDevices(await deviceViews([A, B]), [
      ['dev-100', d => isActive(d) || 'inactive', 'WP01 active'],
      ['dev-200', d => isActive(d) || 'inactive', 'GM01 active'],
    ]));
  });
}

async function caseStaleQuota() {
  return withClients(seedFor(BASE_DEVICES()), async (A, B) => {
    await openTile(B.page, 'GM02');
    await openTile(A.page, 'WP02');
    await setQuota(A.page, 5);
    const tA = Date.now();
    await waitLocal(A, 'dev-300', d => quotaOf(d) === 5, 'WP02 quota 5', 250);
    await sleep(Math.max(0, 300 - (Date.now() - tA)));
    await toggleReady(B.page); // unrelated save from a client that hasn't seen the quota edit
    await waitLocal(B, 'dev-400', d => d?.isReady === false, 'GM02 Maintenance', 1000);
    log('  A set WP02 quota 5; stale B set GM02 -> Maintenance 0.3s later');
    await closeDrawer(A.page); await closeDrawer(B.page);
    return holds(async () => expectDevices(await deviceViews([A, B]), [
      ['dev-300', d => quotaOf(d) === 5 || `quota ${quotaOf(d)}`, 'WP02 quota 5'],
      ['dev-400', d => d?.isReady === false || 'still ready', 'GM02 Maintenance'],
    ]));
  });
}

async function caseDeleteDevice() {
  const devs = [...BASE_DEVICES(), { id: 'dev-500', name: 'DEL1', isReady: true, quotas: q(2) }];
  return withClients(seedFor(devs), async (A, B) => {
    await openTile(A.page, 'DEL1');
    await deleteOpenDevice(A.page, 'DEL1');
    await waitLocal(A, 'dev-500', d => !d, 'DEL1 removed', 1000);
    // Wait for A's delete to reach the cloud (now or after the 10 s undo window), then B saves at once
    // from its stale copy that still has DEL1, and again a few seconds later.
    const end = Date.now() + 15000;
    while (Date.now() < end && (await cloudDevices()).some(d => d.id === 'dev-500')) await sleep(100);
    log(`  A deleted DEL1 (cloud ${(await cloudDevices()).some(d => d.id === 'dev-500') ? 'still has it' : 'updated'}); B saves now and again in 5s`);
    await openTile(B.page, 'GM02'); await toggleReady(B.page); await closeDrawer(B.page);
    await sleep(5000);
    await openTile(B.page, 'GM02'); await toggleReady(B.page); await closeDrawer(B.page);
    const check = async () => {
      const views = await deviceViews([A, B]);
      const probs = expectDevices(views, [['dev-500', d => !d || 'present', 'DEL1 gone'], ['dev-400', d => d?.isReady === true || 'not ready', 'GM02 Ready']]);
      for (const c of [A, B]) if (await tileCount(c.page, 'DEL1')) probs.push(`${c.label}: DEL1 tile visible`);
      return probs;
    };
    const r = await holds(check, { convergeMs: 12000 });
    if (r) return r;
    await B.page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await B.page.waitForSelector('[data-testid="nav-tab-floor"]', { timeout: 120000 }); await sleep(2500); await gotoTab(B.page, 'floor');
    return holds(check, { convergeMs: 1000, holdMs: 6000 }).then(x => (x ? `after B reload: ${x}` : ''));
  });
}

async function caseDeleteEmbeddedBug() {
  const now = new Date();
  const runId = 'run-plan-1-dev-300-e2ebug';
  const bug = {
    id: 'bug-e2e-delete-1', testRunId: runId, planId: 'plan-1', stepId: 's1', stepTitle: 'Step 1', feature: 'Spotify',
    testerName: 'Amy H', deviceName: 'WP02', severity: 'high', title: 'E2E embedded bug to delete', note: 'E2E embedded bug to delete',
    timestamp: now.toISOString(), formattedTime: now.toLocaleTimeString(), status: 'New',
  };
  const keep = { ...bug, id: 'bug-e2e-keep-1', title: 'E2E bug that stays', note: 'E2E bug that stays' };
  const row = b => ({ id: b.id, test_run_id: b.testRunId, plan_id: b.planId, step_id: b.stepId, step_title: b.stepTitle, feature: b.feature, tester_name: b.testerName, device_name: b.deviceName, severity: b.severity, note: b.note, title: b.title, timestamp: b.timestamp, formatted_time: b.formattedTime, status: b.status, image_url: null });
  const run = {
    id: runId, plan_id: 'plan-1', plan_name: PLAN.name, tester_name: 'Amy H', device_name: 'WP02', device_id: 'dev-300', status: 'completed', current_step_index: 2,
    results: { s1: { status: 'red', stepId: 's1', feature: 'Spotify', timestamp: now.toISOString() }, s2: { status: 'green', stepId: 's2', feature: 'Photo Capture', timestamp: now.toISOString() } },
    bug_logs: [bug, keep], started_at: new Date(now.getTime() - 600000).toISOString(), completed_at: now.toISOString(),
  };
  return withClients(seedFor(BASE_DEVICES(), { archived_runs: [run], bug_logs: [row(bug), row(keep)] }), async (A, B) => {
    await gotoTab(A.page, 'bugs'); await gotoTab(B.page, 'bugs');
    const opened = await A.page.evaluate(id => { const r = document.querySelector(`[data-testid="feed-row"][data-bug-id="${id}"]`); r?.click(); return !!r; }, bug.id);
    if (!opened) {
      const dbg = await A.page.evaluate(() => ({ ids: JSON.parse(localStorage.getItem('qa_bug_logs') || '[]').map(b => b.id), text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 400) }));
      throw new Error(`SETUP: bug row not visible in A ${JSON.stringify(dbg)}`);
    }
    await sleep(300);
    const del = await A.page.evaluate(() => { const b = document.querySelector('[data-testid="feed-row-expanded"] [data-testid="feed-delete-bug"]'); b?.click(); return !!b; });
    if (!del) throw new Error('SETUP: delete button not found');
    log('  A deleted the embedded bug; waiting out the undo window');
    await sleep(12000);
    const check = async () => {
      const probs = [];
      const c = await cloudBugPresent(bug.id);
      if (c) probs.push(`cloud: ${c}`);
      for (const cl of [A, B]) {
        const s = await cl.page.evaluate(id => ({
          ls: (() => { try { return JSON.parse(localStorage.getItem('qa_bug_logs') || '[]').some(b => b.id === id); } catch { return false; } })(),
          dom: !!document.querySelector(`[data-bug-id="${id}"]`),
        }), bug.id);
        if (s.ls || s.dom) probs.push(`${cl.label}: bug still ${s.ls ? 'in storage' : ''}${s.dom ? ' on screen' : ''}`);
        const keepOk = await cl.page.evaluate(id => { try { return JSON.parse(localStorage.getItem('qa_bug_logs') || '[]').some(b => b.id === id); } catch { return false; } }, keep.id);
        if (!keepOk) probs.push(`${cl.label}: the other bug vanished`);
      }
      return probs;
    };
    return holds(check, { convergeMs: 8000 });
  });
}

async function caseDuplicateNameLock() {
  const now = new Date();
  const devs = [...BASE_DEVICES(), { id: 'dev-d1', name: 'DUP1', isReady: true, quotas: q(2) }, { id: 'dev-d2', name: 'DUP1', isReady: true, quotas: q(2) }];
  const run = {
    id: 'run-plan-1-dev-d1-e2elock', plan_id: 'plan-1', plan_name: PLAN.name, tester_name: 'Amy H', device_name: 'DUP1', device_id: 'dev-d1', status: 'in_progress', current_step_index: 1,
    results: { s1: { status: 'green', stepId: 's1', feature: 'Spotify', timestamp: now.toISOString() } }, bug_logs: [], started_at: new Date(now.getTime() - 60000).toISOString(),
  };
  return withClients(seedFor(devs, { test_runs: [run] }), async (A, B) => {
    // Give both dashboards a couple of poll cycles to reconcile locks.
    await sleep(6000);
    const check = async () => {
      const views = await deviceViews([A, B]);
      const probs = expectDevices(views, [['dev-d2', d => (!!d && !d.activeTesterName && !d.activeRunId) || (d ? `locked by ${d.activeTesterName || d.activeRunId}` : 'missing'), 'DUP1 #2 (dev-d2) unlocked']]);
      for (const c of [A, B]) {
        const n = await c.page.evaluate(() => [...document.querySelectorAll('span.font-mono.font-bold')].filter(s => s.textContent.trim() === 'DUP1').map(s => s.closest('div.cursor-pointer')).filter(t => t && /Amy H/.test(t.innerText)).length);
        if (n !== 1) probs.push(`${c.label}: ${n} DUP1 tiles show Amy H in use (want 1)`);
      }
      return probs;
    };
    return holds(check, { convergeMs: 8000 });
  });
}

async function caseFloorToggleAndQuota() {
  return withClients(seedFor(BASE_DEVICES()), async (A, B) => {
    await openTile(A.page, 'WP02');
    await openTile(B.page, 'GM02');
    await toggleReady(A.page);
    const tA = Date.now();
    await waitLocal(A, 'dev-300', d => d?.isReady === false, 'WP02 Maintenance', 250);
    await sleep(Math.max(0, 300 - (Date.now() - tA)));
    await setQuota(B.page, 7);
    await waitLocal(B, 'dev-400', d => quotaOf(d) === 7, 'GM02 quota 7', 1000);
    log('  A set WP02 -> Maintenance; B set GM02 quota 7 0.3s later');
    await closeDrawer(A.page); await closeDrawer(B.page);
    let r = await holds(async () => expectDevices(await deviceViews([A, B]), [
      ['dev-300', d => d?.isReady === false || 'ready', 'WP02 Maintenance'],
      ['dev-400', d => quotaOf(d) === 7 || `quota ${quotaOf(d)}`, 'GM02 quota 7'],
    ]), { holdMs: 8000 });
    if (r) return `step 1: ${r}`;
    // Sequential edits of the same device from both sides: B -> Ready, then A -> quota 3 two seconds later.
    await openTile(B.page, 'WP02'); await toggleReady(B.page); await closeDrawer(B.page);
    await sleep(2000);
    await openTile(A.page, 'WP02'); await setQuota(A.page, 3); await closeDrawer(A.page);
    log('  B set WP02 -> Ready; A set WP02 quota 3 2s later');
    r = await holds(async () => expectDevices(await deviceViews([A, B]), [
      ['dev-300', d => (d?.isReady === true && quotaOf(d) === 3) || `isReady=${d?.isReady} quota=${quotaOf(d)}`, 'WP02 Ready + quota 3'],
      ['dev-400', d => quotaOf(d) === 7 || `quota ${quotaOf(d)}`, 'GM02 quota 7'],
    ]));
    return r ? `step 2: ${r}` : '';
  });
}


// ---------- Undo / Restore ----------
function undoRestoreSeed() {
  const now = new Date();
  const mkBug = (id, runId, dev, title) => ({
    id, testRunId: runId, planId: 'plan-1', stepId: 's1', stepTitle: 'Step 1', feature: 'Spotify', testerName: 'Amy H', deviceName: dev,
    severity: 'high', title, note: title, timestamp: now.toISOString(), formattedTime: now.toLocaleTimeString(), status: 'New',
  });
  const bugRow = b => ({ id: b.id, test_run_id: b.testRunId, plan_id: b.planId, step_id: b.stepId, step_title: b.stepTitle, feature: b.feature, tester_name: b.testerName, device_name: b.deviceName, severity: b.severity, note: b.note, title: b.title, timestamp: b.timestamp, formatted_time: b.formattedTime, status: b.status, image_url: null });
  const run = (id, dev, devName, bugs, minsAgo) => ({
    id, plan_id: 'plan-1', plan_name: PLAN.name, tester_name: 'Amy H', device_name: devName, device_id: dev, status: 'completed', current_step_index: 2,
    results: { s1: { status: bugs.length ? 'red' : 'green', stepId: 's1', feature: 'Spotify', timestamp: now.toISOString() }, s2: { status: 'green', stepId: 's2', feature: 'Photo Capture', timestamp: now.toISOString() } },
    bug_logs: bugs, started_at: new Date(now.getTime() - (minsAgo + 10) * 60000).toISOString(), completed_at: new Date(now.getTime() - minsAgo * 60000).toISOString(),
  });
  const bug = mkBug('bug-ur-1', 'run-plan-1-dev-300-ur1', 'WP02', 'E2E undo/restore bug');
  const devs = [...BASE_DEVICES(), { id: 'dev-500', name: 'DEL1', isReady: true, quotas: q(2) }];
  return {
    seed: seedFor(devs, {
      archived_runs: [run('run-plan-1-dev-300-ur1', 'dev-300', 'WP02', [bug], 30), run('run-plan-1-dev-400-ur2', 'dev-400', 'GM02', [], 20)],
      bug_logs: [bugRow(bug)],
    }),
    bugId: bug.id, bugRunId: 'run-plan-1-dev-300-ur1', runId: 'run-plan-1-dev-400-ur2',
  };
}
const lsHas = (page, key, id) => page.evaluate((k, i) => { try { return JSON.parse(localStorage.getItem(k) || '[]').some(x => x?.id === i); } catch { return false; } }, key, id);

async function caseUndoRestore(kind, mode) {
  const S = undoRestoreSeed();
  const ENT = {
    device: {
      label: 'device DEL1',
      del: async A => { await openTile(A.page, 'DEL1'); await deleteOpenDevice(A.page, 'DEL1'); },
      cloud: async () => ((await cloudDevices()).some(d => d.id === 'dev-500') ? '' : 'missing from devices config / tombstoned'),
      client: async c => ((await lsHas(c.page, 'qa_devices_list', 'dev-500')) ? '' : 'not in qa_devices_list'),
    },
    tester: {
      label: 'tester Bo K',
      del: async A => {
        await A.page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Pool & Roster')?.click());
        await sleep(400);
        const ok = await A.page.evaluate(() => { const b = document.querySelector('button[title="Delete Bo K"]'); b?.click(); return !!b; });
        if (!ok) throw new Error('SETUP: tester delete button not found');
      },
      cloud: async () => ((await cloudTesters()).some(t => t.id === 't2') ? '' : 'missing from testers config / tombstoned'),
      client: async c => ((await lsHas(c.page, 'qa_testers_list', 't2')) ? '' : 'not in qa_testers_list'),
    },
    bug: {
      label: 'bug embedded in a run',
      del: async A => {
        await gotoTab(A.page, 'bugs');
        const ok = await A.page.evaluate(id => { const r = document.querySelector(`[data-testid="feed-row"][data-bug-id="${id}"]`); r?.click(); return !!r; }, S.bugId);
        if (!ok) throw new Error('SETUP: bug row not visible in A');
        await sleep(300);
        const del = await A.page.evaluate(() => { const b = document.querySelector('[data-testid="feed-row-expanded"] [data-testid="feed-delete-bug"]'); b?.click(); return !!b; });
        if (!del) throw new Error('SETUP: bug delete button not found');
      },
      cloud: async () => {
        const t = await cloudState();
        const tomb = new Set();
        for (const p of prefixed(t, '__GLOBAL_DELETED_BUGS__:')) collectIds(p, tomb);
        const probs = [];
        if (tomb.has(S.bugId)) probs.push('still tombstoned');
        if (!(t.bug_logs?.rows || []).some(r => r.id === S.bugId)) probs.push('no bug_logs row');
        const run = (t.archived_runs?.rows || []).find(r => r.id === S.bugRunId);
        let bl = run?.bug_logs;
        if (typeof bl === 'string') { try { bl = JSON.parse(bl); } catch { bl = []; } }
        if (!Array.isArray(bl) || !bl.some(b => b?.id === S.bugId)) probs.push('not embedded in its run again');
        return probs.join(', ');
      },
      client: async c => ((await lsHas(c.page, 'qa_bug_logs', S.bugId)) ? '' : 'not in qa_bug_logs'),
    },
    run: {
      label: 'archived run on GM02',
      del: async A => {
        await openTile(A.page, 'GM02');
        const ok = await A.page.evaluate(() => { const b = document.querySelector('button[title="Delete run"]'); b?.click(); return !!b; });
        if (!ok) throw new Error('SETUP: Delete run button not found in the GM02 panel');
        await sleep(200);
        await closeDrawer(A.page);
      },
      cloud: async () => {
        const t = await cloudState();
        const tomb = new Set();
        for (const p of prefixed(t, '__GLOBAL_DELETED_RUNS__:')) collectIds(p, tomb);
        const probs = [];
        if (tomb.has(S.runId)) probs.push('still tombstoned');
        if (!(t.archived_runs?.rows || []).some(r => r.id === S.runId)) probs.push('no archived_runs row');
        return probs.join(', ');
      },
      client: async c => ((await lsHas(c.page, 'qa_archived_runs', S.runId)) || (await lsHas(c.page, 'qa_test_runs', S.runId)) ? '' : 'not in qa_archived_runs'),
    },
  }[kind];
  return withClients(S.seed, async (A, B) => {
    const present = async () => {
      const probs = [];
      const c = await ENT.cloud(); if (c) probs.push(`cloud: ${c}`);
      for (const cl of [A, B]) { const x = await ENT.client(cl); if (x) probs.push(`${cl.label}: ${x}`); }
      return probs;
    };
    const p0 = await present();
    if (p0.length) throw new Error(`SETUP: ${ENT.label} not present at start: ${p0.join('; ')}`);
    await ENT.del(A);
    await sleep(800);
    if (!(await ENT.client(A))) throw new Error(`SETUP: ${ENT.label} still in A after delete`);
    if (mode === 'undo') {
      const ok = await A.page.evaluate(() => { const b = document.querySelector('[data-testid="undo-toast-button"]'); b?.click(); return !!b; });
      if (!ok) throw new Error('SETUP: undo toast button not found');
      log(`  A deleted ${ENT.label} and clicked Undo`);
    } else {
      await sleep(12000); // past the 10 s undo window
      await A.page.evaluate(() => document.querySelector('[data-testid="data-menu-button"]')?.click());
      await sleep(300);
      await A.page.evaluate(() => document.querySelector('[data-testid="data-menu-recently-deleted"]')?.click());
      await sleep(500);
      const ok = await A.page.evaluate(k => {
        const row = document.querySelector(`[data-testid="recently-deleted-row"][data-deleted-type="${k}"]`);
        const b = row?.querySelector('[data-testid="recently-deleted-restore"]');
        b?.click();
        return !!b;
      }, kind);
      if (!ok) throw new Error(`SETUP: no Recently deleted row of type ${kind}`);
      await sleep(300);
      await A.page.evaluate(() => document.querySelector('[data-testid="recently-deleted-close"]')?.click());
      log(`  A deleted ${ENT.label}, waited 12s, restored it from Recently deleted`);
    }
    return holds(present, { convergeMs: 12000, holdMs: 15000 });
  });
}

const CASES = [
  ['1a', 'concurrent activations 0.3 s apart', () => caseConcurrentActivate(300)],
  ['1b', 'concurrent activations 2 s apart', () => caseConcurrentActivate(2000)],
  ['2', 'quota edit survives a stale unrelated save', caseStaleQuota],
  ['3', 'deleted device stays deleted in the other client', caseDeleteDevice],
  ['4', 'bug embedded in a run stays deleted', caseDeleteEmbeddedBug],
  ['5', 'run on one of two same-named devices locks only it', caseDuplicateNameLock],
  ['6', 'Floor Ready/Maintenance + quota edits stick', caseFloorToggleAndQuota],
  ['7a', 'Undo brings back a deleted device', () => caseUndoRestore('device', 'undo')],
  ['7b', 'Undo brings back a deleted tester', () => caseUndoRestore('tester', 'undo')],
  ['7c', 'Undo brings back a deleted bug embedded in a run', () => caseUndoRestore('bug', 'undo')],
  ['7d', 'Undo brings back a deleted run', () => caseUndoRestore('run', 'undo')],
  ['8a', 'Recently deleted restores a device', () => caseUndoRestore('device', 'restore')],
  ['8b', 'Recently deleted restores a tester', () => caseUndoRestore('tester', 'restore')],
  ['8c', 'Recently deleted restores a bug embedded in a run', () => caseUndoRestore('bug', 'restore')],
  ['8d', 'Recently deleted restores a run', () => caseUndoRestore('run', 'restore')],
];

async function main() {
  const results = [];
  try {
    await startServers();
    browser = await puppeteer.launch({ headless: argv.headful ? false : 'new', executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
    // Warm-up: the first load makes vite optimize deps, which can take a while on a busy machine.
    await (await openClient('warmup')).ctx.close();
    for (const [id, name, fn] of CASES) {
      if (ONLY && !ONLY.has(id)) continue;
      log(`case ${id}: ${name}`);
      let err = '';
      try { err = await fn(); } catch (e) { err = `ERROR ${e?.message || e}`; }
      results.push({ id, name, err });
      log(err ? `  FAIL ${err}` : '  PASS');
    }
  } finally {
    await browser?.close().catch(() => {});
    stopServers();
  }
  console.log('\n=== e2e-sync summary ===');
  for (const r of results) console.log(`${r.err ? 'FAIL' : 'PASS'}  ${r.id.padEnd(3)} ${r.name}${r.err ? `\n        ${r.err.slice(0, 400)}` : ''}`);
  const failed = results.filter(r => r.err).length;
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed || !results.length ? 1 : 0);
}
main().catch(e => { console.error(e); stopServers(); process.exit(1); });
