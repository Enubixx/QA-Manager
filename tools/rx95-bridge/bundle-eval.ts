/**
 * Accuracy harness for RX95 same-day bundling (read-only; never writes Supabase or Buganizer).
 *
 *   npx tsx tools/rx95-bridge/bundle-eval.ts collect        # live bugs (read-only) -> $MATCH_EVAL_DIR/bundle_bugs.json
 *   npx tsx tools/rx95-bridge/bundle-eval.ts judge [--run=name.json] [--days=2026-10-15]
 *   npx tsx tools/rx95-bridge/bundle-eval.ts report [--run=name.json]
 *
 * Truth comes from the repro-matching answer key (repro_labels.json + issues.json from match-eval):
 * two reports are a TRUE pair when they map to the same Buganizer bug (gold/own, duplicates
 * folded into their canonical bug), NEUTRAL when they only share a closely-related ("ok") bug,
 * UNKNOWN when neither has a known bug (printed for manual review), else a FALSE pair.
 * Unlabelled reports still go into the prompts (realistic days) but their pairs are not scored.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BugLog, BundleSuggestion } from '../../src/types';
import { laDay, parseBundleReply, splitForPrompt, toBundleInput } from '../../src/utils/bundleMatch';
import { judgeBundlesWithRx95 } from './watcher';

const args = Object.fromEntries(process.argv.slice(3).map(a => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.join('=') || 'true'];
}));
const CMD = process.argv[2] || 'report';
const CACHE = process.env.MATCH_EVAL_DIR || path.join(os.homedir(), '.cache/qa-match-eval');
const HOTLISTS: Record<string, string> = { 'plan-1787946982095': '8810391', 'plan-1791908761906': '8682925' };
const readJson = <T>(f: string, d: T): T => { try { return JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8')); } catch { return d; } };
const writeJson = (f: string, v: unknown) => fs.writeFileSync(path.join(CACHE, f), JSON.stringify(v, null, 1));
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}% (${a}/${b})` : 'n/a');

async function collect() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const env = Object.fromEntries(fs.readFileSync(path.resolve(here, '../../.env.local'), 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
  }));
  const get = async (q: string) => {
    const r = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/${q}`, { headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}` } });
    if (!r.ok) throw new Error(`supabase ${r.status}`);
    return r.json();
  };
  const bugs = new Map<string, BugLog>();
  for (const b of await get('bug_logs?select=*&limit=5000')) {
    bugs.set(b.id, { id: b.id, testRunId: b.test_run_id, planId: b.plan_id, stepId: b.step_id || '', stepTitle: b.step_title || '', feature: b.feature || '', testerName: b.tester_name || '', deviceName: b.device_name || '', severity: b.severity || 'medium', note: b.note || '', title: b.title || undefined, refined: b.refined || undefined, timestamp: b.timestamp, formattedTime: b.formatted_time || '' } as BugLog);
  }
  for (const table of ['test_runs', 'archived_runs'])
    for (const run of await get(`${table}?select=plan_id,bug_logs&limit=5000`))
      for (const b of Array.isArray(run.bug_logs) ? run.bug_logs : []) {
        if (!b?.id) continue;
        const prev = bugs.get(b.id);
        bugs.set(b.id, prev ? { ...b, ...prev, refined: prev.refined || b.refined, title: prev.title || b.title } : { ...b, planId: b.planId || run.plan_id });
      }
  // Yesterday's labelled bugs (match-eval collect) are no longer live after the daily wipe; their ids carry the timestamp.
  for (const q of readJson<any[]>('qa_bugs.json', [])) {
    const ms = Number(String(q.id).match(/^bug-(\d{13})-/)?.[1]);
    if (!bugs.has(q.id) && ms) bugs.set(q.id, { ...q, timestamp: new Date(ms).toISOString(), testerName: '', deviceName: '' } as BugLog);
  }
  writeJson('bundle_bugs.json', [...bugs.values()]);
  console.log(`bugs: ${bugs.size}`);
}

interface Truth { t: Set<string>; o: Set<string>; labelled: boolean }
function loadTruth(): Map<string, Truth> {
  const issues: Record<string, { id: string; status?: string; hotlistIds?: string[]; hotlistId: string }> = readJson('issues.json', {});
  const labels: Record<string, { gold?: string[]; ok?: string[]; own?: string[] }> = readJson('repro_labels.json', {});
  const canonical = (id: string) => {
    let cur = id;
    for (let k = 0; k < 5; k++) { const m = String(issues[cur]?.status || '').match(/DUPLICATE of (\d+)/); if (!m) break; cur = m[1]; }
    return cur;
  };
  const bugs: BugLog[] = readJson('bundle_bugs.json', []);
  const out = new Map<string, Truth>();
  for (const b of bugs) {
    const lab = labels[b.id.replace(/^bug-/, '')];
    if (!lab) { out.set(b.id, { t: new Set(), o: new Set(), labelled: false }); continue; }
    const h = HOTLISTS[b.planId];
    const resolve = (sfx: string[] = []) => sfx.flatMap(s => Object.values(issues).filter(i => i.id.endsWith(s) && (i.hotlistIds || [i.hotlistId]).includes(h)).map(i => canonical(i.id)));
    out.set(b.id, { t: new Set(resolve([...(lab.gold || []), ...(lab.own || [])])), o: new Set(resolve(lab.ok)), labelled: true });
  }
  return out;
}

/** Plan-day groups exactly as the worker builds them (unfiled, not Repro'd, ≥2 reports). */
function planDays(bugs: BugLog[]) {
  const groups = new Map<string, BugLog[]>();
  for (const b of bugs) {
    if (!b.planId || (b as any).status === "Repro'd Issue") continue;
    const day = laDay(b.originalTimestamp || b.timestamp);
    if (!day || (args.days && !String(args.days).split(',').includes(day))) continue;
    const k = `${b.planId}|${day}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(b);
  }
  return [...groups].filter(([, g]) => g.length >= 2);
}

interface RunRec { key: string; reportIds: string[]; suggestions: BundleSuggestion[] }

async function judge() {
  const bugs: BugLog[] = readJson('bundle_bugs.json', []);
  const runFile = String(args.run || `bundle-run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const recs: RunRec[] = [];
  const jobs = planDays(bugs).flatMap(([key, g]) => splitForPrompt(g.map(toBundleInput)).map((chunk, i) => ({ key: `${key}#${i}`, chunk })));
  console.log(`judging ${jobs.length} plan-day chunk(s): ${jobs.map(j => `${j.key}(${j.chunk.length})`).join(', ')}`);
  let next = 0;
  await Promise.all(Array.from({ length: Number(args.parallel || 3) }, async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      try {
        const { reply, conversationId } = await judgeBundlesWithRx95(j.chunk, j.key);
        const suggestions = parseBundleReply(reply, j.chunk);
        if (!suggestions) { console.warn('unparseable reply', conversationId); continue; }
        recs.push({ key: j.key, reportIds: j.chunk.map(r => r.id), suggestions });
        writeJson(runFile, recs);
        console.log(`done ${j.key}: ${suggestions.length} bundle(s) chat ${conversationId}`);
      } catch (e: any) { console.warn('chunk failed', j.key, e.message); }
    }
  }));
  report(runFile);
}

function report(runFile = String(args.run || '')) {
  if (!runFile) runFile = fs.readdirSync(CACHE).filter(f => f.startsWith('bundle-run-')).sort().pop() || '';
  const recs: RunRec[] = readJson(runFile, []);
  const truth = loadTruth();
  const bugs = new Map((readJson('bundle_bugs.json', []) as BugLog[]).map(b => [b.id, b]));
  const kind = (a: string, b: string): 'true' | 'neutral' | 'unknown' | 'false' | 'unlabelled' => {
    const A = truth.get(a), B = truth.get(b);
    if (!A?.labelled || !B?.labelled) return 'unlabelled';
    if ([...A.t].some(x => B.t.has(x))) return 'true';
    const aa = new Set([...A.t, ...A.o]);
    if ([...B.t, ...B.o].some(x => aa.has(x))) return 'neutral';
    if (!A.t.size && !B.t.size) return 'unknown';
    return 'false';
  };
  const show = (id: string) => { const b = bugs.get(id); return `${id.slice(-4)} "${(b?.title || b?.note || '').slice(0, 60)}"`; };
  let tp = 0, fp = 0, neutral = 0, unknown = 0, unl = 0, maybeTrue = 0, maybeFalse = 0, allTrue = 0, found = 0;
  const falses: string[] = [], unknowns: string[] = [], misses: string[] = [];
  for (const r of recs) {
    const ids = r.reportIds;
    const sure = (s: BundleSuggestion) => s.memberIds.filter(id => !(s.maybeIds || []).includes(id));
    const pairKey = (a: string, b: string) => [a, b].sort().join('|');
    const predicted = new Set<string>();
    const maybePairs = new Set<string>();
    for (const s of r.suggestions) {
      const m = sure(s);
      for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) predicted.add(pairKey(m[i], m[j]));
      for (const x of s.maybeIds || []) for (const y of m) maybePairs.add(pairKey(x, y));
    }
    for (const p of predicted) {
      const [a, b] = p.split('|');
      const k = kind(a, b);
      if (k === 'true') tp++; else if (k === 'false') { fp++; falses.push(`${show(a)} + ${show(b)}`); } else if (k === 'neutral') neutral++; else if (k === 'unknown') { unknown++; unknowns.push(`${show(a)} + ${show(b)}`); } else unl++;
    }
    for (const p of maybePairs) { const [a, b] = p.split('|'); const k = kind(a, b); if (k === 'true') maybeTrue++; else if (k === 'false') maybeFalse++; }
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      if (kind(ids[i], ids[j]) !== 'true') continue;
      allTrue++;
      const p = pairKey(ids[i], ids[j]);
      if (predicted.has(p)) found++; else misses.push(`${show(ids[i])} + ${show(ids[j])}${maybePairs.has(p) ? ' (maybe)' : ''}`);
    }
  }
  console.log(`\n=== ${runFile}: ${recs.length} chunk(s), ${recs.reduce((n, r) => n + r.suggestions.length, 0)} suggestion(s) ===`);
  console.log(`pair precision=${pct(tp, tp + fp)}  pair recall=${pct(found, allTrue)}  false merges=${fp}  neutral=${neutral}  unknown(no labels)=${unknown}  unlabelled=${unl}  maybe pairs: true ${maybeTrue} / false ${maybeFalse}`);
  if (args.errors) {
    for (const f of falses) console.log('  FALSE  ', f);
    for (const u of unknowns) console.log('  UNKNOWN', u);
    for (const m of misses) console.log('  MISS   ', m);
    for (const r of recs) for (const s of r.suggestions) console.log(`  [${r.key}] ${s.confidence}% "${s.title}" = ${s.memberIds.map(id => id.slice(-4) + ((s.maybeIds || []).includes(id) ? '?' : '')).join(',')}`);
  }
}

(async () => {
  if (CMD === 'collect') await collect();
  else if (CMD === 'judge') await judge();
  else report();
})().catch(e => { console.error(e); process.exit(1); });
