import type { BugLog, BundleSuggestion } from '../types';
import { bugTextSig } from './bugRefine';

/**
 * RX95 same-day bundling: groups unfiled reports from one test plan + day that describe the same
 * issue, so they can be filed once as a "mega bug". Shared by the RX95 worker (prompt) and the
 * eval; the app only reads the resulting BundleSuggestionSet rows.
 */
export const BUNDLE_STYLE_VERSION = 'b2';
export const BUNDLE_MAX_REPORTS_PER_PROMPT = 40;
export const BUNDLE_MIN_CONFIDENCE = 50;
export const BUNDLE_TITLE_MAX = 100;
export const BUNDLE_SUMMARY_MAX = 600;
export const BUNDLE_REASON_MAX = 240;

export interface BundleReportInput {
  id: string;
  title: string;
  note: string;
  feature: string;
  stepTitle: string;
  refinedTitle?: string;
  refinedDescription?: string;
  testerName?: string;
  deviceName?: string;
  /** ISO timestamp */
  timestamp?: string;
}

export const toBundleInput = (b: BugLog): BundleReportInput => {
  const refined = b.refined && b.refined.sig === bugTextSig(b) ? b.refined : undefined;
  return {
    id: String(b.id || '').slice(0, 120),
    title: String(b.title || '').slice(0, 300),
    note: String(b.note || '').slice(0, 2000),
    feature: String(b.feature || '').slice(0, 200),
    stepTitle: String(b.stepTitle || '').slice(0, 300),
    ...(refined ? { refinedTitle: String(refined.title || '').slice(0, 300), refinedDescription: String(refined.description || '').slice(0, 2000) } : {}),
    testerName: String(b.testerName || '').slice(0, 80),
    deviceName: String(b.deviceName || '').slice(0, 80),
    timestamp: String(b.timestamp || '').slice(0, 40),
  };
};

/** YYYY-MM-DD of an instant in America/Los_Angeles (the team's test day). */
export function laDay(iso: string | undefined): string {
  const d = new Date(String(iso || ''));
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Fingerprint of a plan-day's candidate reports (ids + texts); suggestions are recomputed when it changes. */
export function bundleGroupSig(reports: Array<Pick<BugLog, 'id' | 'title' | 'note'>>): string {
  const parts = [...reports].sort((a, b) => a.id.localeCompare(b.id)).map(r => `${r.id}\u0001${bugTextSig(r)}`);
  return `${BUNDLE_STYLE_VERSION}-${stableHash(parts.join('\u0002'))}-${reports.length}`;
}

/** Stable suggestion id from its member ids. */
export const bundleSuggestionId = (memberIds: string[]) => `bs-${stableHash([...memberIds].sort().join('|'))}`;

/** Splits a big plan-day into prompt-sized chunks, keeping each CUJ together where possible. */
export function splitForPrompt<T extends { feature: string }>(reports: T[], max = BUNDLE_MAX_REPORTS_PER_PROMPT): T[][] {
  if (reports.length <= max) return reports.length ? [reports] : [];
  const byCuj = new Map<string, T[]>();
  for (const r of reports) {
    const k = (r.feature || 'General').trim().toLowerCase();
    if (!byCuj.has(k)) byCuj.set(k, []);
    byCuj.get(k)!.push(r);
  }
  const chunks: T[][] = [];
  let cur: T[] = [];
  for (const group of [...byCuj.values()].sort((a, b) => b.length - a.length)) {
    if (group.length > max) {
      for (let i = 0; i < group.length; i += max) chunks.push(group.slice(i, i + max));
      continue;
    }
    if (cur.length + group.length > max) { chunks.push(cur); cur = []; }
    cur.push(...group);
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

const oneLine = (s: string | undefined, max = 300) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
const clock = (iso?: string) => {
  const d = new Date(String(iso || ''));
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(d);
};

/** Prompt for one plan-day chunk. Reports are referred to as R1..Rn (mapped back by the parser). */
export function buildBundlePrompt(reports: BundleReportInput[]): { prompt: string; reportId: string } {
  const list = reports.map((r, i) => [
    `R${i + 1}`,
    `  CUJ: ${oneLine(r.feature) || 'General'} · Step: ${oneLine(r.stepTitle) || 'Unknown'}`,
    `  Logged: ${[clock(r.timestamp), oneLine(r.testerName, 60), oneLine(r.deviceName, 60)].filter(Boolean).join(' · ') || 'unknown'}`,
    `  Reporter title: ${oneLine(r.title) || '(none)'}`,
    `  Reporter note: ${r.note.trim() && r.note.trim() !== r.title.trim() ? oneLine(r.note, 1200) : '(none)'}`,
    ...(r.refinedTitle ? [`  Cleaned title: ${oneLine(r.refinedTitle)}`] : []),
    ...(r.refinedDescription ? [`  Cleaned description: ${oneLine(r.refinedDescription, 1200)}`] : []),
  ].join('\n')).join('\n\n');
  const reportId = `RB-${stableHash(`${BUNDLE_STYLE_VERSION}|${list}`)}`;
  const prompt = `You are a senior QA triager for smart glasses (Gemini on Glasses). Below are field-test bug reports from ONE test plan on ONE day, written quickly by different testers on different devices. Find the groups of reports that describe the SAME issue, so each group can be filed once in Buganizer.

Testers type fast on a phone: expect typos, shorthand and dictation errors. Judge meaning, not wording.

REPORTS (${reports.length}):
${list}

RULES - be strict, a wrong merge hides a real bug:
- Same issue = the SAME symptom AND the SAME trigger in the same flow (same feature/action/command). Different testers, devices, times or wording are fine.
- Compare SYMPTOM (what goes wrong: no audio, wrong language, echo/repeats, crash/session ends, can't do X, wrong result, UI stuck, latency) and TRIGGER (what the user was doing).
- NEVER group reports with the same CUJ but a different symptom (e.g. "Gemini answers in Korean" vs "Keep note saved in Korean"; "can't play the song" vs "SWW while the song plays").
- NEVER group a report that has an extra major failure the other does not mention (e.g. one also crashes or ends the session, the other only repeats itself).
- Different CUJ labels or test steps alone do NOT make reports different: testers often log the same problem under neighbouring CUJs (e.g. "YouTube Music" vs "Music Playback"). Judge by symptom + trigger.
- Some symptoms are general Gemini behaviour that does not depend on the action, e.g. answering in the wrong language (Korean, French, Portuguese...) or echoing / repeating its own phrase ("let me take a look" twice). Reports with that same symptom are the same issue even when the user was doing different things.
- Vague reports ("doesn't work", "inaccurate") only join a group when their details clearly match it.
- If a report probably belongs to a group but you are not sure, put it in that group's "maybe" list instead of "members".
- Each report may appear in at most one group. Leave reports that match nothing out entirely. Groups need at least 2 members.

For each group return: "members": ["R1","R4",...] (the reports you are sure about, at least 2), "maybe": ["R7"] (or []), "title": one clear line, 5 to 14 words, at most ${BUNDLE_TITLE_MAX} characters, saying what goes wrong and where (no "[...]" prefixes, no tester names), "summary": 1-3 plain sentences of what happened, combining the reports' details without inventing any, at most ${BUNDLE_SUMMARY_MAX} characters, "confidence": 0-100 that all members are the same issue, "reason": one line quoting the matching symptom and trigger, at most 200 characters.
Only use report labels listed above (R1..R${reports.length}); never invent any.

Return ONLY a JSON object: {"bundles":[{"members":["R1","R2"],"maybe":[],"title":"...","summary":"...","confidence":90,"reason":"..."}]}  (use {"bundles":[]} when no reports belong together)`;
  return { prompt, reportId };
}

function extractJson(reply: string): any {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1);
  try { return JSON.parse(body); } catch { return null; }
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Strictly parses RX95's grouping for one chunk: only listed labels, member sets disjoint (a report
 * claimed twice stays with the higher-confidence group), maybe ⊄ members, ≥2 members, confidence
 * ≥ BUNDLE_MIN_CONFIDENCE. Returns null when the reply is not usable at all.
 */
export function parseBundleReply(reply: string, reports: Array<Pick<BundleReportInput, 'id'>>): BundleSuggestion[] | null {
  const parsed = extractJson(reply);
  if (!parsed || !Array.isArray(parsed.bundles)) return null;
  const refToId = (v: unknown): string | null => {
    const m = String(v ?? '').trim().match(/^R?(\d{1,3})$/i);
    const n = m ? Number(m[1]) : NaN;
    return Number.isInteger(n) && n >= 1 && n <= reports.length ? reports[n - 1].id : null;
  };
  const raw = parsed.bundles
    .filter((b: any) => b && typeof b === 'object')
    .map((b: any) => {
      const members = [...new Set((Array.isArray(b.members) ? b.members : []).map(refToId).filter(Boolean) as string[])];
      const maybe = [...new Set((Array.isArray(b.maybe) ? b.maybe : []).map(refToId).filter(Boolean) as string[])].filter(id => !members.includes(id));
      let confidence = Math.round(Number(b.confidence));
      confidence = Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : 0;
      return { members, maybe, confidence, title: clean(b.title, BUNDLE_TITLE_MAX).replace(/^\[[^\]]*\]\s*/g, '').replace(/[.]+$/, ''), summary: clean(b.summary, BUNDLE_SUMMARY_MAX), reason: clean(b.reason, BUNDLE_REASON_MAX) };
    })
    .sort((a: any, b: any) => b.confidence - a.confidence);
  const taken = new Set<string>();
  const out: BundleSuggestion[] = [];
  for (const b of raw) {
    if (b.confidence < BUNDLE_MIN_CONFIDENCE || !b.title) continue;
    const members = b.members.filter((id: string) => !taken.has(id));
    if (members.length < 2) continue;
    const maybe = b.maybe.filter((id: string) => !taken.has(id) && !members.includes(id));
    [...members, ...maybe].forEach(id => taken.add(id));
    const all = [...members, ...maybe];
    out.push({ id: bundleSuggestionId(all), memberIds: all, ...(maybe.length ? { maybeIds: maybe } : {}), title: b.title, summary: b.summary || b.title, confidence: b.confidence, reason: b.reason });
  }
  return out;
}
