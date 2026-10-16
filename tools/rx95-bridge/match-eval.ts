/**
 * Accuracy harness for RX95 "Repro'd Issue" matching (read-only; never writes Supabase or Buganizer).
 *
 *   npx tsx tools/rx95-bridge/match-eval.ts collect            # cache hotlists, descriptions, QA bugs
 *   npx tsx tools/rx95-bridge/match-eval.ts shortlist          # offline shortlist recall@25
 *   npx tsx tools/rx95-bridge/match-eval.ts judge [--limit=N] [--batch=6] [--sets=qa,dup,neg]
 *   npx tsx tools/rx95-bridge/match-eval.ts report [--run=<file>]
 *
 * Gold sets, all from real data:
 *   qa   QA Manager bugs that were filed in Buganizer (the filed description carries
 *        "QA Manager bug-<id>"); query = the reporter's raw title + note, gold = the filed issue
 *        (or its canonical bug if it was closed as a duplicate).
 *   dup  Hotlist bugs closed as "DUPLICATE of Y" where Y is still a candidate; query = the
 *        duplicate's own text (another person describing the same problem), gold = Y.
 *   neg  qa queries with the gold bug removed from the candidates: any "very_likely" is wrong.
 * Candidate descriptions are redacted of the QA Manager id and the reporter's original note so the
 * qa set can't match on copied text.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import {
  MATCH_SHORTLIST_SIZE, parseMatchReplyBatch, shortlistCandidates, splitFiledTitle, trimDescription,
  type HotlistCandidate, type MatchBugInput, type MatchJob,
} from '../../src/utils/reproMatch';
import { judgeMatchesWithRx95, parseIssuesSearchOutput, parseRenderedDescription } from './watcher';

const args = Object.fromEntries(process.argv.slice(3).map(a => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.join('=') || 'true'];
}));
const CMD = process.argv[2] || 'report';
const CACHE = process.env.MATCH_EVAL_DIR || path.join(os.homedir(), '.cache/qa-match-eval');
const HOTLISTS: Record<string, string> = { 'plan-1787946982095': '8810391', 'plan-1791908761906': '8682925' };
const ISSUES_CLI = '/google/bin/releases/issues-cli/issues';
const CANDIDATE_STATUS = /^(NEW|ASSIGNED|ACCEPTED|FIXED|VERIFIED)$/;
fs.mkdirSync(CACHE, { recursive: true });

const cli = (argv: string[]) => new Promise<string>((resolve, reject) =>
  execFile(ISSUES_CLI, ['readonly', ...argv], { maxBuffer: 50 * 1024 * 1024, timeout: 60_000 }, (e, out, err) => (e ? reject(new Error(String(err || e.message))) : resolve(String(out)))));
const readJson = <T>(f: string, d: T): T => { try { return JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8')); } catch { return d; } };
const writeJson = (f: string, v: unknown) => fs.writeFileSync(path.join(CACHE, f), JSON.stringify(v, null, 1));

interface Issue extends HotlistCandidate { hotlistId: string; fullDescription: string }
interface QaBug { id: string; planId: string; title?: string; note: string; feature?: string; stepTitle?: string }

// ---------- collect ----------
async function collect() {
  const issues: Record<string, Issue> = readJson('issues.json', {});
  for (const hotlistId of Object.values(HOTLISTS)) {
    let token = '';
    let n = 0;
    do {
      const out = await cli(['search', `hotlistid:${hotlistId}`, '--limit', '500', '--fields', 'issue_id,title,status,priority', ...(token ? ['--page_token', token] : [])]);
      for (const b of parseIssuesSearchOutput(out)) { issues[b.id] = { ...(issues[b.id] || { fullDescription: '' }), ...b, hotlistId }; n++; }
      token = out.match(/^Next page token:\s*(\S+)/m)?.[1] || '';
    } while (token);
    console.log(`hotlist ${hotlistId}: ${n} issues`);
  }
  const todo = Object.values(issues).filter(i => !i.fullDescription);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < todo.length) {
      const it = todo[next++];
      try { it.fullDescription = parseRenderedDescription(await cli(['render', it.id, '--fields', 'desc'])) || ' '; } catch (e: any) { console.warn('render failed', it.id, e.message.slice(0, 100)); }
      if (++done % 50 === 0) { console.log(`descriptions ${done}/${todo.length}`); writeJson('issues.json', issues); }
    }
  }));
  writeJson('issues.json', issues);

  // QA bugs: READ-ONLY Supabase (anon key) - bug_logs table + bugs embedded in test runs
  const env = Object.fromEntries(fs.readFileSync(path.resolve(__dirname_(), '../../.env.local'), 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
  }));
  const get = async (q: string) => {
    const r = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/${q}`, { headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}` } });
    if (!r.ok) throw new Error(`supabase ${r.status}`);
    return r.json();
  };
  const bugs = new Map<string, QaBug>();
  for (const b of await get('bug_logs?select=id,plan_id,title,note,feature,step_title&limit=5000'))
    bugs.set(b.id, { id: b.id, planId: b.plan_id, title: b.title || '', note: b.note || '', feature: b.feature || '', stepTitle: b.step_title || '' });
  for (const run of await get('test_runs?select=plan_id,bug_logs&limit=5000'))
    for (const b of Array.isArray(run.bug_logs) ? run.bug_logs : [])
      if (b?.id && !bugs.has(b.id)) bugs.set(b.id, { id: b.id, planId: b.planId || run.plan_id, title: b.title || '', note: b.note || '', feature: b.feature || '', stepTitle: b.stepTitle || '' });
  writeJson('qa_bugs.json', [...bugs.values()]);
  console.log(`QA bugs: ${bugs.size}; issues: ${Object.keys(issues).length}`);
}
function __dirname_() { return path.dirname(new URL(import.meta.url).pathname); }

// ---------- gold ----------
interface EvalItem { key: string; set: 'qa' | 'dup' | 'neg'; hotlistId: string; bug: MatchBugInput; gold: string[]; exclude: string[] }

/** Removes text copied from the QA bug so the qa set can't match on it. */
export function redact(desc: string): string {
  return desc
    .replace(/\*\*Reporter's original note\*\*[\s\S]*$/i, '')
    .replace(/^_?Logged by .*QA Manager bug-[\w-]+_?\s*$/gm, '')
    .replace(/QA Manager bug-[\w-]+/g, '');
}

/** "**What happened**\n..." section of a QA-Manager-filed description, else the whole text. */
function problemText(desc: string): string {
  const m = desc.match(/\*\*What happened\*\*\s*([\s\S]*?)(?=\n\*\*|$)/);
  return trimDescription(m ? m[1] : desc, 1500);
}

function loadData() {
  const issues: Record<string, Issue> = readJson('issues.json', {});
  const qaBugs: QaBug[] = readJson('qa_bugs.json', []);
  const candidatesByHotlist: Record<string, HotlistCandidate[]> = {};
  for (const i of Object.values(issues)) {
    if (!CANDIDATE_STATUS.test(String(i.status || ''))) continue;
    (candidatesByHotlist[i.hotlistId] ||= []).push({ id: i.id, title: i.title, status: i.status, priority: i.priority, description: redact(i.fullDescription || '') });
  }
  return { issues, qaBugs, candidatesByHotlist };
}

function buildGold(): { items: EvalItem[]; candidatesByHotlist: Record<string, HotlistCandidate[]> } {
  const { issues, qaBugs, candidatesByHotlist } = loadData();
  const isCand = (id: string, h: string) => (candidatesByHotlist[h] || []).some(c => c.id === id);
  const canonical = (id: string): string => {
    let cur = id;
    for (let k = 0; k < 5; k++) {
      const m = String(issues[cur]?.status || '').match(/DUPLICATE of (\d+)/);
      if (!m) break;
      cur = m[1];
    }
    return cur;
  };
  // Every hotlist issue that is (a duplicate of) the canonical bug counts as correct.
  const sameBug = (canon: string) => [canon, ...Object.values(issues).filter(i => canonical(i.id) === canon).map(i => i.id)];

  const items: EvalItem[] = [];
  const qaById = new Map(qaBugs.map(b => [b.id, b]));
  const seenQa = new Set<string>();
  for (const i of Object.values(issues)) {
    const qaId = (i.fullDescription || '').match(/QA Manager (bug-[\w-]+)/)?.[1];
    const qa = qaId ? qaById.get(qaId) : undefined;
    if (!qa || seenQa.has(qa.id)) continue;
    const canon = canonical(i.id);
    if (!isCand(canon, i.hotlistId)) continue; // filed bug was closed (obsolete, not reproducible, ...): not a candidate
    seenQa.add(qa.id);
    const bug: MatchBugInput = { id: qa.id, title: qa.title || '', note: qa.note || '', feature: qa.feature || '', stepTitle: qa.stepTitle || '' };
    const gold = sameBug(canon);
    items.push({ key: `qa:${qa.id}`, set: 'qa', hotlistId: i.hotlistId, bug, gold, exclude: [] });
    items.push({ key: `neg:${qa.id}`, set: 'neg', hotlistId: i.hotlistId, bug, gold: [], exclude: gold });
  }
  for (const d of Object.values(issues)) {
    const m = String(d.status || '').match(/DUPLICATE of (\d+)/);
    if (!m) continue;
    const canon = canonical(d.id);
    if (!isCand(canon, d.hotlistId)) continue;
    const { cuj, text } = splitFiledTitle(d.title);
    const desc = redact(d.fullDescription || '');
    const bug: MatchBugInput = { id: d.id, title: text, note: problemText(desc), feature: cuj || (desc.match(/^- CUJ:\s*(.+)$/m)?.[1] || ''), stepTitle: desc.match(/^- Step:\s*(.+)$/m)?.[1] || '' };
    items.push({ key: `dup:${d.id}`, set: 'dup', hotlistId: d.hotlistId, bug, gold: sameBug(canon).filter(x => x !== d.id), exclude: [d.id] });
  }
  return { items, candidatesByHotlist };
}

function jobFor(item: EvalItem, candidatesByHotlist: Record<string, HotlistCandidate[]>, size = MATCH_SHORTLIST_SIZE): MatchJob {
  const pool = (candidatesByHotlist[item.hotlistId] || []).filter(c => !item.exclude.includes(c.id));
  const shortlist = shortlistCandidates(item.bug, pool, size).map(s => ({ ...s.candidate, description: trimDescription(s.candidate.description || '') }));
  return { bug: item.bug, shortlist };
}

// ---------- shortlist eval ----------
function shortlistEval() {
  const { items, candidatesByHotlist } = buildGold();
  for (const set of ['qa', 'dup'] as const) {
    const list = items.filter(i => i.set === set);
    const at = (k: number) => list.filter(i => jobFor(i, candidatesByHotlist, k).shortlist.some(c => i.gold.includes(c.id))).length;
    console.log(`${set}: n=${list.length}  recall@5=${pct(at(5), list.length)}  @10=${pct(at(10), list.length)}  @25=${pct(at(25), list.length)}  @40=${pct(at(40), list.length)}`);
    if (args.misses) for (const i of list) {
      const j = jobFor(i, candidatesByHotlist, 25);
      if (!j.shortlist.some(c => i.gold.includes(c.id))) console.log(`  MISS ${i.key} [${i.bug.feature}] "${i.bug.title} | ${i.bug.note.slice(0, 120)}" -> gold ${i.gold[0]} "${(candidatesByHotlist[i.hotlistId].find(c => c.id === i.gold[0])?.title || '').slice(0, 110)}"`);
    }
  }
}
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}% (${a}/${b})` : 'n/a');

// ---------- RX95 judge eval ----------
interface RunRecord { key: string; set: string; gold: string[]; shortlistHit: boolean; result: Array<{ id: string; verdict: string; confidence: number; reason: string }> }

async function judgeEval() {
  const { items, candidatesByHotlist } = buildGold();
  const sets = String(args.sets || 'qa,dup,neg').split(',');
  const limit = Number(args.limit || 1e9);
  const batch = Number(args.batch || 6);
  const runFile = String(args.run || `run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const records: RunRecord[] = readJson(runFile, []);
  const done = new Set(records.map(r => r.key));
  // deterministic sample spread across sets
  const chosen = sets.flatMap(s => items.filter(i => i.set === s).sort((a, b) => a.key.localeCompare(b.key)).slice(0, limit)).filter(i => !done.has(i.key));
  // shuffle so qa and neg variants of the same bug don't land in the same chat
  chosen.sort((a, b) => hash(a.key) - hash(b.key));
  console.log(`judging ${chosen.length} items in batches of ${batch} -> ${path.join(CACHE, runFile)}`);
  const parallel = Number(args.parallel || 3);
  const batches: EvalItem[][] = [];
  for (let i = 0; i < chosen.length; i += batch) batches.push(chosen.slice(i, i + batch));
  let next = 0;
  await Promise.all(Array.from({ length: parallel }, async () => {
    while (next < batches.length) {
      const group = batches[next++];
      const jobs = group.map(i => jobFor(i, candidatesByHotlist));
      try {
        const { reply, conversationId } = await judgeMatchesWithRx95(jobs);
        const parsed = parseMatchReplyBatch(reply, jobs.map(j => j.shortlist));
        group.forEach((it, k) => records.push({
          key: it.key, set: it.set, gold: it.gold,
          shortlistHit: jobs[k].shortlist.some(c => it.gold.includes(c.id)),
          result: parsed[k].map(c => ({ id: c.id, verdict: c.verdict, confidence: c.confidence, reason: c.reason })),
        }));
        writeJson(runFile, records);
        console.log(`batch done (${records.length} records) chat ${conversationId}`);
      } catch (e: any) {
        console.warn('batch failed:', e.message);
      }
    }
  }));
  report(runFile);
}
const hash = (s: string) => { let h = 0; for (const c of s) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0; return h; };

function report(runFile = String(args.run || '')) {
  if (!runFile) runFile = fs.readdirSync(CACHE).filter(f => f.startsWith('run-')).sort().pop() || '';
  const recs: RunRecord[] = readJson(runFile, []);
  console.log(`\n=== ${runFile}: ${recs.length} records ===`);
  const top = (r: RunRecord) => r.result[0];
  const vl = recs.filter(r => top(r)?.verdict === 'very_likely');
  const vlCorrect = vl.filter(r => r.gold.includes(top(r).id));
  const pos = recs.filter(r => r.set !== 'neg');
  console.log(`very_likely top-1 precision (all sets): ${pct(vlCorrect.length, vl.length)}`);
  for (const set of ['qa', 'dup', 'neg']) {
    const s = recs.filter(r => r.set === set);
    if (!s.length) continue;
    const sv = s.filter(r => top(r)?.verdict === 'very_likely');
    const line = [`${set}: n=${s.length}`];
    if (set !== 'neg') {
      line.push(`shortlist@25=${pct(s.filter(r => r.shortlistHit).length, s.length)}`);
      line.push(`recall@5=${pct(s.filter(r => r.result.some(c => r.gold.includes(c.id))).length, s.length)}`);
      line.push(`top1=${pct(s.filter(r => top(r) && r.gold.includes(top(r).id)).length, s.length)}`);
      line.push(`vl-precision=${pct(sv.filter(r => r.gold.includes(top(r).id)).length, sv.length)}`);
      line.push(`vl-coverage=${pct(sv.length, s.length)}`);
    } else {
      line.push(`false very_likely=${pct(sv.length, s.length)}`);
    }
    console.log(line.join('  '));
  }
  console.log(`positives recall@5: ${pct(pos.filter(r => r.result.some(c => r.gold.includes(c.id))).length, pos.length)}`);
  if (args.errors) for (const r of recs) {
    const t = top(r);
    const wrongVl = t?.verdict === 'very_likely' && !r.gold.includes(t.id);
    const missed = r.set !== 'neg' && !r.result.some(c => r.gold.includes(c.id));
    if (wrongVl || missed) console.log(`  ${wrongVl ? 'WRONG-VL' : 'MISS'} ${r.key} gold=${r.gold[0] || '-'} top=${t ? `${t.id} ${t.verdict} ${t.confidence} "${t.reason}"` : 'none'}`);
  }
}

(async () => {
  if (CMD === 'collect') await collect();
  else if (CMD === 'shortlist') shortlistEval();
  else if (CMD === 'judge') await judgeEval();
  else report();
})().catch(e => { console.error(e); process.exit(1); });
