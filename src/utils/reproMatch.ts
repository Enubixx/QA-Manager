import type { BugLog, ReproCandidate } from '../types';
import { bugTextSig } from './bugRefine';

/**
 * RX95 "Repro'd Issue" matching: finds the existing Buganizer bug a QA bug most likely reproduces.
 * Shared by the app (request + strict reply parsing) and the RX95 bridge (shortlist + prompt),
 * so both always agree. Requests carry only structured bug data - the bridge builds the prompt.
 *
 * Pipeline: hotlist bugs -> shortlist(top 25 by fuzzy word overlap + same CUJ) -> full
 * descriptions -> RX95 judges symptom / trigger / CUJ -> at most 5 ranked candidates.
 */
export const MATCH_STYLE_VERSION = 'm1';
export const MATCH_SHORTLIST_SIZE = 30;
export const MATCH_MAX_RESULTS = 5;
export const MATCH_MIN_UNLIKELY_CONFIDENCE = 25;
export const MATCH_DESCRIPTION_MAX = 1200;
export const MATCH_REASON_MAX = 240;
export const MATCH_MAX_BUGS_PER_PROMPT = 8;

export interface MatchBugInput {
  id: string;
  title: string;
  note: string;
  feature: string;
  stepTitle: string;
  refinedTitle?: string;
  refinedDescription?: string;
}

/** A bug in the plan's Buganizer hotlist. */
export interface HotlistCandidate {
  id: string;
  title: string;
  status?: string;
  priority?: string;
  /** Trimmed description (only fetched for the shortlist). */
  description?: string;
}

export type CatalogEntry = Pick<HotlistCandidate, 'id' | 'title' | 'status' | 'priority'>;

export const toMatchInput = (b: BugLog): MatchBugInput => {
  const refined = b.refined && b.refined.sig === bugTextSig(b) ? b.refined : undefined;
  return {
    id: String(b.id || '').slice(0, 120),
    title: String(b.title || '').slice(0, 300),
    note: String(b.note || '').slice(0, 2000),
    feature: String(b.feature || '').slice(0, 200),
    stepTitle: String(b.stepTitle || '').slice(0, 300),
    ...(refined ? { refinedTitle: String(refined.title || '').slice(0, 300), refinedDescription: String(refined.description || '').slice(0, 2000) } : {}),
  };
};

// ---------- text helpers ----------
const PRODUCT_PREFIX = /^\s*\[\s*gemini on glasses\s*\]\s*/i;

/** Splits a filed title into its CUJ tag and the plain title ("[Gemini on Glasses] [CUJ] text"). */
export function splitFiledTitle(title: string): { cuj: string; text: string } {
  let t = String(title || '').replace(PRODUCT_PREFIX, '');
  let cuj = '';
  const m = t.match(/^\s*\[([^\]]{1,80})\]\s*/);
  if (m) { cuj = m[1].trim(); t = t.slice(m[0].length); }
  return { cuj, text: t.trim() };
}

export const normCuj = (s: string) => String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

const STOP = new Set(('a an the and or but if then than so to of in on at by for from with without into onto over under up down out off is are was were be been being am ' +
  'it its this that these those there here i me my we our you your he she they them his her their what which who whom when where why how ' +
  'not no do does did done doing have has had having can could should would will just also very really still even only again after before ' +
  'while during about as some any all more most other such same own too s t don didn doesn isn wasn ok okay im ive got get gets getting go goes went ' +
  'gemini gl glasses glass user tester says said saying tried try trying time times thing things like seems seemed one way').split(/\s+/));

function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith('es')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  return w;
}

/** Phrases folded to one token before splitting (shorthand testers and filers use interchangeably). */
const PHRASES: Array<[RegExp, string]> = [
  [/something went wrong/g, ' sww '],
  [/\b(?:youtube|yt) music\b/g, ' youtube music '],
  [/\bytm\b/g, ' youtube music '],
  [/\bnano ?banana\b/g, ' nb '],
  [/\bdynamic camera\b/g, ' dc '],
  [/\bhot ?word\b/g, ' hotword '],
  [/\bshut (?:down|off)\b/g, ' crash '],
  [/\bquit chime\b/g, ' error chime '],
];

/** Domain synonyms (after stemming) mapped to one canonical token. */
const CANON: Record<string, string> = Object.fromEntries(([
  ['symbol', 'hieroglyph hieroglyphic hieroglyphics glyph aymbol symbl unicode illustration drawing'],
  ['start', 'launch launche begin began'],
  ['crash', 'quit terminat termination terminate shutdown'],
  ['echo', 'repeat repeate stutter twice'],
  ['tap', 'touchpad touch'],
  ['language', 'korean french portuguese spanish chinese japanese lang languag'],
  ['youtube', 'yt'],
  ['music', 'song playlist track'],
  ['photo', 'picture image pic'],
  ['translat', 'translate translation translator translato translati'],
  ['navigat', 'navigation navigate'],
  ['disconnect', 'disconnection'],
  ['hallucinat', 'hallucinate hallucination'],
] as Array<[string, string]>).flatMap(([canon, words]) => words.split(' ').map(w => [w, canon])));

export function tokenize(text: string): string[] {
  let t = String(text || '').toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/[’']/g, '');
  for (const [re, rep] of PHRASES) t = t.replace(re, rep);
  return t
    .split(/[^a-z0-9]+/)
    .filter(w => w.length >= 2 && !STOP.has(w) && !/^\d{1,2}$/.test(w))
    .map(w => { const st = stem(w); return CANON[st] || CANON[w] || st; });
}

/** Damerau-free Levenshtein with an early exit once the distance exceeds `max`. */
function within(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

/** 1 for the same word, ~0.8 for a typo / shared stem, else 0. */
function wordSim(a: string, b: string): number {
  if (a === b) return 1;
  const min = Math.min(a.length, b.length);
  if (min >= 5 && (a.startsWith(b) || b.startsWith(a))) return 0.8;
  if (min >= 4 && within(a, b, min >= 8 ? 2 : 1)) return 0.8;
  return 0;
}

// ---------- shortlist ----------
export interface ScoredCandidate { candidate: HotlistCandidate; score: number }

/** Query text for a QA bug (reporter text plus RX95's cleaned wording when available). */
export const bugQueryText = (b: MatchBugInput) =>
  [b.title, b.note, b.refinedTitle, b.refinedDescription].filter(Boolean).join(' \n ');

/**
 * Ranks hotlist bugs by IDF-weighted, typo-tolerant word overlap with the QA bug, plus a boost
 * when the filed title carries the bug's CUJ tag. Cheap: decides which bugs RX95 reads.
 */
export function shortlistCandidates(bug: MatchBugInput, candidates: HotlistCandidate[], size = MATCH_SHORTLIST_SIZE): ScoredCandidate[] {
  const docs = candidates.map(c => {
    const { cuj, text } = splitFiledTitle(c.title);
    return { c, cuj: normCuj(cuj), title: new Set(tokenize(text)), desc: new Set(tokenize(c.description || '')) };
  });
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set([...d.title, ...d.desc])) df.set(w, (df.get(w) || 0) + 1);
  const N = Math.max(1, docs.length);
  const idf = (w: string) => Math.log(1 + N / (1 + (df.get(w) || 0)));

  const qTitle = new Set(tokenize([bug.title, bug.refinedTitle].filter(Boolean).join(' ')));
  const qAll = new Set([...qTitle, ...tokenize([bug.note, bug.refinedDescription].filter(Boolean).join(' '))]);
  const feature = normCuj(bug.feature);

  // Typo-tolerant matches: for each query word, the vocabulary words within a small edit distance.
  const vocab = new Set<string>();
  for (const d of docs) { for (const w of d.title) vocab.add(w); for (const w of d.desc) vocab.add(w); }
  const near = new Map<string, string[]>();
  for (const w of qAll) near.set(w, [...vocab].filter(x => x !== w && wordSim(w, x) > 0));
  const best = (w: string, set: Set<string>) => (set.has(w) ? 1 : near.get(w)!.some(x => set.has(x)) ? 0.8 : 0);
  const scored = docs.map(d => {
    let s = 0, norm = 0;
    for (const w of qAll) {
      const weight = idf(w) * (qTitle.has(w) ? 1.5 : 1);
      norm += weight;
      const hit = Math.max(best(w, d.title), 0.6 * best(w, d.desc));
      s += weight * hit;
    }
    let score = norm > 0 ? s / norm : 0;
    if (feature && d.cuj && (d.cuj === feature || d.cuj.includes(feature) || feature.includes(d.cuj))) score += 0.15;
    return { candidate: d.c, score };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, size);
}

/** Stage-1 size: title-only ranking, whose descriptions are then fetched for the final ranking. */
export const MATCH_STAGE1_SIZE = 60;

/**
 * Two-stage shortlist shared by the bridge and the eval: rank every hotlist bug by title (+CUJ),
 * fetch descriptions for the top MATCH_STAGE1_SIZE, re-rank with title + description, keep `size`.
 */
export async function twoStageShortlist(
  bug: MatchBugInput,
  candidates: HotlistCandidate[],
  fetchDescriptions: (ids: string[]) => Promise<Map<string, string>>,
  size = MATCH_SHORTLIST_SIZE,
): Promise<HotlistCandidate[]> {
  const stage1 = shortlistCandidates(bug, candidates.map(({ description, ...c }) => c), MATCH_STAGE1_SIZE).map(s => s.candidate);
  const descs = await fetchDescriptions(stage1.map(c => c.id));
  const withDesc = stage1.map(c => ({ ...c, description: trimDescription(descs.get(c.id) || '') }));
  return shortlistCandidates(bug, withDesc, size).map(s => s.candidate);
}

// ---------- prompt ----------
function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const oneLine = (s: string | undefined, max = 300) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Section headings after which a Buganizer description is only logs / builds / boilerplate. */
const BOILERPLATE = /^.*\bsoftware versions?\b.*$|^\s*[*_#=\-\s]*(?:environment|supporting logs?|logs?|builds?|hardware|build number|bug ?reports?|attachments?|device info|originating component)\b.*$/im;

/** Trims a Buganizer description to the parts that describe the problem (drops env/log boilerplate). */
export function trimDescription(desc: string, max = MATCH_DESCRIPTION_MAX): string {
  let t = String(desc || '').replace(/\r\n?/g, '\n').replace(/^Description by .*?:\s*$/m, '');
  const cut = t.search(BOILERPLATE);
  // keep the reporter's original note (QA Manager format puts it after Environment)
  const note = t.match(/\*\*Reporter's original note\*\*[\s\S]*$/i)?.[0] || '';
  if (cut > 0) t = t.slice(0, cut) + (note && t.indexOf(note) > cut ? `\n${note}` : '');
  return t
    .replace(/^_?Logged by .*$/gm, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\b(?:sherlogs?|timestamp)\b[^\n]{0,40}?:?\s*$/gim, '')
    .replace(/^\s*[-=*_]{3,}\s*$/gm, '')
    .replace(/^\s*(?:summary of issues?|what happened)\s*:?\s*$/gim, '')
    .replace(/\*\*/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
    .slice(0, max);
}

export interface MatchJob { bug: MatchBugInput; shortlist: HotlistCandidate[] }

/** Prompt the RX95 bridge sends: each QA bug with its own shortlist, all listed as data. */
export function buildMatchPrompt(jobs: MatchJob[]): { prompt: string; reportId: string } {
  const blocks = jobs.map((j, i) => {
    const b = j.bug;
    const qa = [
      `QA BUG #${i + 1}`,
      `  CUJ: ${oneLine(b.feature) || 'General'}`,
      `  Test step: ${oneLine(b.stepTitle) || 'Unknown'}`,
      `  Reporter title: ${oneLine(b.title) || '(none)'}`,
      `  Reporter note: ${b.note.trim() && b.note.trim() !== b.title.trim() ? oneLine(b.note, 1500) : '(none)'}`,
      ...(b.refinedTitle ? [`  Cleaned title: ${oneLine(b.refinedTitle)}`] : []),
      ...(b.refinedDescription ? [`  Cleaned description: ${oneLine(b.refinedDescription, 1500)}`] : []),
    ].join('\n');
    const cands = j.shortlist.map(c => [
      `  - ID ${c.id} [${(c.status || '?').replace(/[^\w ]/g, '').slice(0, 20)}] ${oneLine(c.title)}`,
      c.description ? `    Description: ${oneLine(trimDescription(c.description), MATCH_DESCRIPTION_MAX)}` : '',
    ].filter(Boolean).join('\n')).join('\n');
    return `${qa}\n  Existing Buganizer bugs to compare (${j.shortlist.length}):\n${cands || '  (none)'}`;
  }).join('\n\n');
  const reportId = `RM-${stableHash(`${MATCH_STYLE_VERSION}|${blocks}`)}`;
  const prompt = `You are a senior QA triager for smart glasses (Gemini on Glasses). A field tester marked each QA bug below as a "Repro'd Issue": they believe it reproduces a bug that is ALREADY filed in Buganizer. For each QA bug, decide which of ITS listed existing bugs (if any) describe the same underlying problem.

Testers type fast on a phone: expect typos, shorthand and dictation errors. Filed bugs were written more formally, often by someone else, so judge meaning, not wording.

${blocks}

HOW TO JUDGE each candidate against the QA bug - compare three things:
1. SYMPTOM: what goes wrong (e.g. no audio, wrong answer, crash/session ends, UI stuck, wrong language, latency).
2. TRIGGER: what the user was doing when it happened (the command, app, action or condition).
3. CUJ / feature area.
Verdicts:
- "very_likely": the SAME symptom AND the SAME trigger (same feature/action). Specific details agree (app, command, error, what Gemini said or did). If the symptom differs OR the trigger differs, it can NEVER be "very_likely" - at most "possible".
- "possible": clearly related (same symptom with a vaguer or slightly different trigger, or same trigger with a related symptom), but you cannot be sure it is the same bug.
- "unlikely": only shares the feature area or generic words.
Confidence (0-100) is how sure you are that it is the same bug: very_likely 80-100, possible 35-79, unlikely 0-34. At most one or two candidates per QA bug should be very_likely; when several look alike, prefer the most specific match.

For EVERY QA bug return "n" (its number) and "matches": up to ${MATCH_MAX_RESULTS} candidates from that bug's own list, best first, leaving out clearly unrelated ones (use [] if nothing is related). Each match: {"id": "<ID exactly as listed>", "verdict": "very_likely" | "possible" | "unlikely", "confidence": <0-100>, "reason": "<one line, at most 200 characters, quoting the matching (or differing) details from both bugs>"}.
Never invent or alter IDs, and never use an ID from another QA bug's list.

Return ONLY a JSON object: {"bugs":[{"n":1,"matches":[{"id":"...","verdict":"...","confidence":90,"reason":"..."}]}, ...]}`;
  return { prompt, reportId };
}

// ---------- reply parsing ----------
const VERDICTS = new Set(['very_likely', 'possible', 'unlikely']);

function extractJson(reply: string): any {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1);
  try { return JSON.parse(body); } catch { return null; }
}

/** Validates one bug's matches strictly against its shortlist catalog. */
export function cleanMatches(items: unknown, catalog: CatalogEntry[]): ReproCandidate[] {
  const byId = new Map(catalog.map(c => [String(c.id), c]));
  const out: ReproCandidate[] = [];
  const seen = new Set<string>();
  for (const it of Array.isArray(items) ? items : []) {
    const id = String((it as any)?.id ?? '').replace(/^b\//i, '').trim();
    const cat = byId.get(id);
    if (!/^\d{4,12}$/.test(id) || !cat || seen.has(id)) continue;
    const verdict = String((it as any)?.verdict || '').toLowerCase().replace(/[\s-]+/g, '_');
    if (!VERDICTS.has(verdict)) continue;
    let confidence = Math.round(Number((it as any)?.confidence));
    if (!Number.isFinite(confidence)) continue;
    confidence = Math.max(0, Math.min(100, confidence));
    if (verdict === 'unlikely' && confidence < MATCH_MIN_UNLIKELY_CONFIDENCE) continue;
    const reason = String((it as any)?.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, MATCH_REASON_MAX);
    seen.add(id);
    out.push({ id, title: String(cat.title || '').slice(0, 300), status: cat.status || undefined, priority: cat.priority || undefined, confidence, verdict: verdict as ReproCandidate['verdict'], reason });
  }
  const rank = { very_likely: 2, possible: 1, unlikely: 0 } as const;
  return out.sort((a, b) => b.confidence - a.confidence || rank[b.verdict] - rank[a.verdict]).slice(0, MATCH_MAX_RESULTS);
}

/** Parses a multi-bug reply; catalogs[i] is QA bug #i+1's shortlist. */
export function parseMatchReplyBatch(reply: string, catalogs: CatalogEntry[][]): ReproCandidate[][] {
  const parsed = extractJson(reply);
  const out: ReproCandidate[][] = catalogs.map(() => []);
  for (const it of Array.isArray(parsed?.bugs) ? parsed.bugs : []) {
    const n = Number(it?.n);
    if (!Number.isInteger(n) || n < 1 || n > catalogs.length || out[n - 1].length) continue;
    out[n - 1] = cleanMatches(it?.matches, catalogs[n - 1]);
  }
  return out;
}

export interface MatchReplyMeta { hotlistId: string; searched: number; catalog: CatalogEntry[] }

/**
 * Parses the bridge's reply for a single-bug match request. The bridge attaches the verified
 * shortlist (`candidatesCatalog`), `hotlistId` and `searched`; only catalog IDs are accepted.
 */
export function parseMatchReply(reply: string): { meta: MatchReplyMeta; candidates: ReproCandidate[] } {
  const parsed = extractJson(reply);
  if (!parsed || typeof parsed !== 'object') throw new Error("RX95's reply could not be read.");
  const catalog: CatalogEntry[] = (Array.isArray(parsed.candidatesCatalog) ? parsed.candidatesCatalog : [])
    .filter((c: any) => /^\d{4,12}$/.test(String(c?.id ?? '')))
    .map((c: any) => ({ id: String(c.id), title: String(c.title || '').slice(0, 300), status: c.status ? String(c.status).slice(0, 40) : undefined, priority: c.priority ? String(c.priority).slice(0, 10) : undefined }));
  const hotlistId = /^\d{4,12}$/.test(String(parsed.hotlistId ?? '')) ? String(parsed.hotlistId) : '';
  const searched = Number.isFinite(Number(parsed.searched)) ? Math.max(0, Math.round(Number(parsed.searched))) : catalog.length;
  const first = Array.isArray(parsed.bugs) ? parsed.bugs.find((b: any) => Number(b?.n) === 1) || parsed.bugs[0] : parsed;
  return { meta: { hotlistId, searched, catalog }, candidates: cleanMatches(first?.matches, catalog) };
}
