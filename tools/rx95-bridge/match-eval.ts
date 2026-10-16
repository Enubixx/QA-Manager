/**
 * Accuracy harness for RX95 "Repro'd Issue" matching (read-only; never writes Supabase or Buganizer).
 *
 *   npx tsx tools/rx95-bridge/match-eval.ts collect            # cache hotlists, descriptions, QA bugs
 *   npx tsx tools/rx95-bridge/match-eval.ts shortlist          # offline shortlist recall@25
 *   npx tsx tools/rx95-bridge/match-eval.ts judge [--limit=N] [--batch=6] [--sets=qa,dup,neg]
 *   npx tsx tools/rx95-bridge/match-eval.ts report [--run=<file>]
 *
 * Gold sets, all from real data (labels live outside the repo, in $MATCH_EVAL_DIR):
 *   repro  MAIN SET. Every live QA Manager bug, hand-labelled with the hotlist bugs it reproduces
 *          (repro_labels.json: gold = same bug, ok = closely related / neutral, own = the issue
 *          filed from that very QA bug, which is removed from the candidates). Bugs with no gold
 *          left are negatives: any "very_likely" outside `ok` is wrong.
 *   filed  QA bugs whose filed issue carries "QA Manager bug-<id>"; query = the reporter's raw
 *          title + note, gold = that issue (or its canonical bug if closed as a duplicate).
 *   dup    HARD SET. Hotlist bugs closed as "DUPLICATE of Y" (Y still a candidate); query = the
 *          duplicate's own text. Triagers often dup symptoms into root-cause bugs, so this is a
 *          stress test, not the release target.
 * Candidate descriptions are redacted of the QA Manager id and the reporter's original note so a
 * query can't match on text copied from itself.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  MATCH_SHORTLIST_SIZE, buildMatchPrompt, parseMatchReplyBatch, shortlistCandidates, splitFiledTitle, trimDescription, twoStageShortlist,
  type HotlistCandidate, type MatchBugInput, type MatchJob,
} from '../../src/utils/reproMatch';
import { MAX_AGENTAPI_PROMPT_BYTES, judgeMatchesWithRx95, parseIssuesSearchOutput, parseRenderedDescription } from './watcher';

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

interface Issue extends HotlistCandidate { hotlistId: string; hotlistIds?: string[]; fullDescription: string }
interface QaBug { id: string; planId: string; title?: string; note: string; feature?: string; stepTitle?: string }

// ---------- collect ----------
async function collect() {
  const issues: Record<string, Issue> = readJson('issues.json', {});
  const seen = new Set<string>();
  for (const hotlistId of Object.values(HOTLISTS)) {
    let token = '';
    let n = 0;
    do {
      const out = await cli(['search', `hotlistid:${hotlistId}`, '--limit', '500', '--fields', 'issue_id,title,status,priority', ...(token ? ['--page_token', token] : [])]);
      for (const b of parseIssuesSearchOutput(out)) {
        const prev = issues[b.id];
        const hotlistIds = [...new Set([...(seen.has(b.id) ? prev?.hotlistIds || [] : []), hotlistId])];
        seen.add(b.id);
        issues[b.id] = { ...(prev || { fullDescription: '' }), ...b, hotlistId: hotlistIds[0], hotlistIds };
        n++;
      }
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
function __dirname_() { return path.dirname(fileURLToPath(import.meta.url)); }

// ---------- gold ----------
interface EvalItem { key: string; set: 'repro' | 'filed' | 'dup'; hotlistId: string; bug: MatchBugInput; gold: string[]; ok: string[]; exclude: string[] }

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
    for (const h of i.hotlistIds || [i.hotlistId]) (candidatesByHotlist[h] ||= []).push({ id: i.id, title: i.title, status: i.status, priority: i.priority, description: redact(i.fullDescription || '') });
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
    const qaId = (i.fullDescription || '').match(/QA Manager (bug-\d+-[a-z0-9]+)/)?.[1];
    const qa = qaId ? qaById.get(qaId) : undefined;
    if (!qa || seenQa.has(qa.id)) continue;
    const canon = canonical(i.id);
    const hotlistId = HOTLISTS[qa.planId] || i.hotlistId; // production searches the QA bug's plan hotlist
    if (!isCand(canon, hotlistId)) continue; // filed bug was closed (obsolete, not reproducible, ...): not a candidate
    seenQa.add(qa.id);
    const bug: MatchBugInput = { id: qa.id, title: qa.title || '', note: qa.note || '', feature: qa.feature || '', stepTitle: qa.stepTitle || '' };
    const gold = sameBug(canon);
    items.push({ key: `filed:${qa.id}`, set: 'filed', hotlistId, bug, gold, ok: [], exclude: [] });
  }
  for (const d of Object.values(issues)) {
    const m = String(d.status || '').match(/DUPLICATE of (\d+)/);
    if (!m) continue;
    const canon = canonical(d.id);
    const hotlistId = (d.hotlistIds || [d.hotlistId]).find(h => isCand(canon, h));
    if (!hotlistId) continue;
    const { cuj, text } = splitFiledTitle(d.title);
    const desc = redact(d.fullDescription || '');
    const bug: MatchBugInput = { id: d.id, title: text, note: problemText(desc), feature: cuj || (desc.match(/^- CUJ:\s*(.+)$/m)?.[1] || ''), stepTitle: desc.match(/^- Step:\s*(.+)$/m)?.[1] || '' };
    items.push({ key: `dup:${d.id}`, set: 'dup', hotlistId, bug, gold: sameBug(canon).filter(x => x !== d.id), ok: [], exclude: [d.id] });
  }
  // Hand-labelled repro set
  const labels: Record<string, { gold?: string[]; ok?: string[]; own?: string[] }> = readJson('repro_labels.json', {});
  for (const qa of qaBugs) {
    const lab = labels[qa.id.replace(/^bug-/, '')];
    const hotlistId = HOTLISTS[qa.planId];
    if (!lab || !hotlistId) continue;
    const pool = candidatesByHotlist[hotlistId] || [];
    const resolve = (suffixes: string[] = []) => suffixes.flatMap(sfx => {
      const hit = pool.filter(c => c.id.endsWith(sfx));
      if (hit.length !== 1) console.warn(`label ${sfx} for ${qa.id}: ${hit.length} matches`);
      return hit.map(c => c.id);
    });
    const own = resolve(lab.own);
    const expand = (ids: string[]) => [...new Set(ids.flatMap(id => sameBug(canonical(id))))];
    const bug: MatchBugInput = { id: qa.id, title: qa.title || '', note: qa.note || '', feature: qa.feature || '', stepTitle: qa.stepTitle || '' };
    const inPool = (id: string) => pool.some(c => c.id === id) && !own.includes(id);
    items.push({ key: `repro:${qa.id}`, set: 'repro', hotlistId, bug, gold: expand(resolve(lab.gold)).filter(inPool), ok: expand(resolve(lab.ok)), exclude: own });
  }
  return { items, candidatesByHotlist };
}

async function jobFor(item: EvalItem, candidatesByHotlist: Record<string, HotlistCandidate[]>, size = MATCH_SHORTLIST_SIZE): Promise<MatchJob> {
  const pool = (candidatesByHotlist[item.hotlistId] || []).filter(c => !item.exclude.includes(c.id));
  const descs = new Map(pool.map(c => [c.id, c.description || '']));
  if (args.single) return { bug: item.bug, shortlist: shortlistCandidates(item.bug, pool.map(c => ({ ...c, description: trimDescription(c.description || '') })), size).map(s => s.candidate) };
  return { bug: item.bug, shortlist: await twoStageShortlist(item.bug, pool, async ids => new Map(ids.map(id => [id, descs.get(id) || ''])), size) };
}

// ---------- shortlist eval ----------
async function shortlistEval() {
  const { items, candidatesByHotlist } = buildGold();
  for (const set of ['repro', 'filed', 'dup'] as const) {
    const list = items.filter(i => i.set === set && i.gold.length > 0);
    const ranks: number[] = [];
    for (const i of list) ranks.push((await jobFor(i, candidatesByHotlist, 60)).shortlist.findIndex(c => i.gold.includes(c.id)));
    const at = (k: number) => ranks.filter(r => r >= 0 && r < k).length;
    console.log(`${set}: n=${list.length}  recall@5=${pct(at(5), list.length)}  @10=${pct(at(10), list.length)}  @25=${pct(at(25), list.length)}  @30=${pct(at(30), list.length)}  @35=${pct(at(35), list.length)}  @40=${pct(at(40), list.length)}  @60=${pct(at(60), list.length)}`);
    if (args.misses) for (const i of list) {
      const j = await jobFor(i, candidatesByHotlist, 25);
      if (!j.shortlist.some(c => i.gold.includes(c.id))) console.log(`  MISS ${i.key} [${i.bug.feature}] "${i.bug.title} | ${i.bug.note.slice(0, 120)}" -> gold ${i.gold[0]} "${(candidatesByHotlist[i.hotlistId].find(c => c.id === i.gold[0])?.title || '').slice(0, 110)}"`);
    }
  }
}
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}% (${a}/${b})` : 'n/a');

// ---------- RX95 judge eval ----------
interface RunRecord { key: string; set: string; gold: string[]; ok?: string[]; shortlistHit: boolean; result: Array<{ id: string; verdict: string; confidence: number; reason: string }> }

async function judgeEval() {
  const { items, candidatesByHotlist } = buildGold();
  const sets = String(args.sets || 'repro,filed').split(',');
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
      const jobs = await Promise.all(group.map(i => jobFor(i, candidatesByHotlist)));
      try {
        while (jobs.length > 1 && Buffer.byteLength(buildMatchPrompt(jobs).prompt) > MAX_AGENTAPI_PROMPT_BYTES - 4000) {
          const it = group.pop()!; jobs.pop(); batches.push([it]); // too big for one chat: judge it separately
        }
        const { reply, conversationId } = await judgeMatchesWithRx95(jobs);
        const parsed = parseMatchReplyBatch(reply, jobs.map(j => j.shortlist));
        group.forEach((it, k) => records.push({
          key: it.key, set: it.set, gold: it.gold, ok: it.ok,
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
  // Score against the current labels (label fixes apply to old runs too)
  const current = new Map(buildGold().items.map(i => [i.key, i]));
  for (const r of recs) { const it = current.get(r.key); if (it) { r.gold = it.gold; r.ok = it.ok; } }
  console.log(`\n=== ${runFile}: ${recs.length} records ===`);
  const top = (r: RunRecord) => r.result[0];
  const neutral = (r: RunRecord) => !!top(r) && !r.gold.includes(top(r).id) && (r.ok || []).includes(top(r).id);
  const isVl = (r: RunRecord) => top(r)?.verdict === 'very_likely' && !neutral(r);
  const summarize = (label: string, s: RunRecord[]) => {
    if (!s.length) return;
    const pos = s.filter(r => r.gold.length > 0);
    const neg = s.filter(r => r.gold.length === 0);
    const vl = s.filter(isVl);
    console.log([
      `${label}: n=${s.length} (pos ${pos.length}, neg ${neg.length})`,
      `VL-precision=${pct(vl.filter(r => r.gold.includes(top(r).id)).length, vl.length)}`,
      `recall@5=${pct(pos.filter(r => r.result.some(c => r.gold.includes(c.id))).length, pos.length)}`,
      `top1=${pct(pos.filter(r => top(r) && r.gold.includes(top(r).id)).length, pos.length)}`,
      `shortlist=${pct(pos.filter(r => r.shortlistHit).length, pos.length)}`,
      `VL-coverage(pos)=${pct(pos.filter(isVl).length, pos.length)}`,
      `false-VL(neg)=${pct(neg.filter(isVl).length, neg.length)}`,
    ].join('  '));
  };
  for (const set of ['repro', 'filed', 'dup']) summarize(set, recs.filter(r => r.set === set));
  summarize('ALL', recs);
  if (args.errors) for (const r of recs) {
    const t = top(r);
    const wrongVl = isVl(r) && !r.gold.includes(t.id);
    const missed = r.gold.length > 0 && !r.result.some(c => r.gold.includes(c.id));
    if (wrongVl || missed) console.log(`  ${wrongVl ? 'WRONG-VL' : 'MISS'} ${r.key} gold=${r.gold[0] || '-'} top=${t ? `${t.id} ${t.verdict} ${t.confidence} "${t.reason}"` : 'none'}`);
  }
}

(async () => {
  if (CMD === 'collect') await collect();
  else if (CMD === 'shortlist') await shortlistEval();
  else if (CMD === 'judge') await judgeEval();
  else report();
})().catch(e => { console.error(e); process.exit(1); });
