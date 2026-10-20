#!/usr/bin/env node
/**
 * Bugs feed ① To review: staged triage + Confirm (offline, no Supabase).
 *   - changing Type / Priority on an expanded row only stages it (not reviewed, row stays in To review)
 *   - Cancel drops the staged change
 *   - Confirm applies it, marks the bug reviewed, closes the row (it leaves To review) and opens the next bug
 *   - closing a row without Confirm drops the staged change
 *   npm run test:e2e:triage
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  s.on('error', rej);
});
async function waitFor(url, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return; } catch {} await sleep(150); }
  throw new Error(`timed out waiting for ${url}`);
}

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}/`;
const vite = spawn('npx', ['--no-install', 'vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
  stdio: 'pipe', detached: true,
  env: { ...process.env, VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '', VITE_PROTOTYPE_SEED_URL: '', VITE_GEMINI_API_KEY: '', VITE_GOOGLE_SCRIPT_URL: '', VITE_RX95_BRIDGE_URL: '' },
});
let browser;
try {
  await waitFor(baseUrl);
  browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(baseUrl, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluate(() => {
    const now = Date.now();
    const bug = (i, title) => ({
      id: `bug-tri-${i}`, testRunId: 'run-tri', planId: 'plan-tri', stepId: 'st1', stepTitle: 'Step 1', feature: 'Camera',
      testerName: 'Alice E2E', deviceName: 'WP-E2E-01', severity: 'medium', title, note: title,
      timestamp: new Date(now - i * 60000).toISOString(), formattedTime: '', status: 'New',
    });
    localStorage.clear();
    localStorage.setItem('qa_prototype_seeded', 'skip');
    localStorage.setItem('qa_test_plans', JSON.stringify([{ id: 'plan-tri', name: 'Triage Plan', description: '', createdAt: new Date().toISOString(), steps: [{ id: 'st1', title: 'Step 1', feature: 'Camera' }] }]));
    localStorage.setItem('qa_testers_list', JSON.stringify([{ id: 't1', name: 'Alice E2E' }]));
    localStorage.setItem('qa_devices_list', JSON.stringify([{ id: 'dev-e2e-1', name: 'WP-E2E-01', isReady: true, quotas: [] }]));
    localStorage.setItem('qa_test_runs', '[]');
    localStorage.setItem('qa_archived_runs', '[]');
    localStorage.setItem('qa_bug_logs', JSON.stringify([bug(1, 'Triage bug one'), bug(2, 'Triage bug two'), bug(3, 'Triage bug three')]));
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.evaluate(() => document.querySelector('[data-testid="nav-tab-bugs"]')?.click());
  await page.waitForSelector('[data-testid="feed-row"]', { timeout: 15000 });

  const order = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="feed-row"]')].map(r => r.getAttribute('data-bug-id')));
  const stored = id => page.evaluate(i => JSON.parse(localStorage.getItem('qa_bug_logs') || '[]').find(b => b.id === i), id);
  const expandedIds = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="feed-row-expanded"]')].map(e => e.parentElement?.id?.replace('feed-row-', '')));
  const setSelect = (rowId, testid, value) => page.evaluate((r, t, v) => {
    const sel = document.querySelector(`#feed-row-${r} [data-testid="${t}"]`);
    if (!sel) throw new Error(`select ${t} not found in ${r}`);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, v);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, rowId, testid, value);
  const click = sel => page.evaluate(s => { const el = document.querySelector(s); if (!el) throw new Error(`${s} not found`); el.click(); }, sel);
  const has = sel => page.evaluate(s => !!document.querySelector(s), sel);

  const ids = await order();
  assert.equal(ids.length, 3, `3 bugs in To review, got ${ids.length}`);
  const [first, second] = ids;

  // 1. Stage a type change: nothing is reviewed yet, row stays, Confirm bar shows
  await click(`#feed-row-${first} [data-testid="feed-row"]`);
  await sleep(200);
  await setSelect(first, 'feed-type', 'Known Issue');
  await sleep(300);
  assert.ok(await has(`#feed-row-${first} [data-testid="feed-triage-confirm"]`), 'Confirm button must appear after staging');
  assert.ok(!(await has(`#feed-row-${first} [data-testid="feed-reviewed-chip"]`)), 'staged row must not be marked reviewed');
  let b1 = await stored(first);
  assert.ok(!b1.reviewed && (b1.bugType || 'Bug') === 'Bug', `staging must not write the bug: ${JSON.stringify({ reviewed: b1.reviewed, bugType: b1.bugType })}`);
  assert.deepEqual(await order(), ids, 'row must stay in To review while staged');

  // 2. Cancel drops the staged change
  await click(`#feed-row-${first} [data-testid="feed-triage-cancel"]`);
  await sleep(200);
  assert.ok(!(await has(`#feed-row-${first} [data-testid="feed-triage-confirm"]`)), 'Cancel hides Confirm');
  assert.equal(await page.$eval(`#feed-row-${first} [data-testid="feed-type"]`, s => s.value), 'Bug', 'Cancel restores the type');

  // 3. Stage type + priority, Confirm -> applied, reviewed, row leaves To review, next bug opens
  await setSelect(first, 'feed-type', 'Known Issue');
  await setSelect(first, 'feed-priority', 'P0');
  await sleep(200);
  await click(`#feed-row-${first} [data-testid="feed-triage-confirm"]`);
  await sleep(500);
  b1 = await stored(first);
  assert.equal(b1.bugType, 'Known Issue', 'Confirm applies type');
  assert.equal(b1.priority, 'P0', 'Confirm applies priority (both staged fields)');
  assert.equal(b1.reviewed?.state, 'reviewed', 'Confirm marks reviewed');
  assert.ok(!(await order()).includes(first), 'confirmed bug leaves To review right away');
  assert.deepEqual(await expandedIds(), [second], `next bug must be expanded, got ${JSON.stringify(await expandedIds())}`);

  // 4. Closing a row without Confirm drops the staged change and does not review it
  await setSelect(second, 'feed-status', "Repro'd Issue");
  await sleep(200);
  assert.ok(await has(`#feed-row-${second} [data-testid="feed-triage-confirm"]`), 'Confirm shows for the next bug');
  await click(`#feed-row-${second} [data-testid="feed-row"]`);
  await sleep(300);
  const b2 = await stored(second);
  assert.ok(!b2.reviewed && (b2.status || 'New') === 'New', 'closing without Confirm must not save');
  assert.ok((await order()).includes(second), 'unconfirmed bug stays in To review');
  await click(`#feed-row-${second} [data-testid="feed-row"]`);
  await sleep(200);
  assert.ok(!(await has(`#feed-row-${second} [data-testid="feed-triage-confirm"]`)), 'reopened row has no stale staged change');

  assert.equal(errors.length, 0, `page errors: ${errors.join('; ')}`);
  console.log('E2E TRIAGE CONFIRM PASSED (stage, cancel, confirm applies + reviews + collapses + opens next, close drops staging)');
} finally {
  await browser?.close().catch(() => {});
  try { process.kill(-vite.pid, 'SIGTERM'); } catch {}
}
