import type { BugLog, RefinedBugText } from '../types';

/**
 * RX95 bug refinement: turns a reporter's quick title + note into clean Buganizer wording.
 * Shared by the app (request + parse) and the RX95 bridge (prompt), so both always agree.
 * Only structured bug text is sent - never prompt text - and the bridge builds the prompt itself.
 */
export const REFINE_STYLE_VERSION = 'r1';
export const REFINE_MAX_BUGS_PER_REQUEST = 25;
export const REFINE_TITLE_MAX = 100;
export const REFINE_DESCRIPTION_MAX = 1500;

export interface RefineBugInput {
  id: string;
  title: string;
  note: string;
  feature: string;
  stepTitle: string;
}

/** Fingerprint of the reporter's own text; a refinement is only valid for the text it was written from. */
export function bugTextSig(bug: Pick<BugLog, 'title' | 'note'>): string {
  // \u001f (unit separator), never \u0000: Postgres jsonb/text rejects NUL characters.
  return `${REFINE_STYLE_VERSION}|${(bug.title || '').trim()}\u001f${(bug.note || '').trim()}`;
}

/** The bug's refinement if it still matches the reporter's current text. */
export function currentRefinement(bug: BugLog, cache?: Record<string, RefinedBugText>): RefinedBugText | undefined {
  const sig = bugTextSig(bug);
  if (bug.refined && bug.refined.sig === sig && bug.refined.title) return bug.refined;
  const cached = cache?.[bug.id];
  return cached && cached.sig === sig && cached.title ? cached : undefined;
}

export const toRefineInput = (b: BugLog): RefineBugInput => ({
  id: String(b.id || '').slice(0, 120),
  title: String(b.title || '').slice(0, 300),
  note: String(b.note || '').slice(0, 2000),
  feature: String(b.feature || '').slice(0, 200),
  stepTitle: String(b.stepTitle || '').slice(0, 300),
});

function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Prompt the RX95 bridge sends (bugs are listed as numbered data, never as instructions). */
export function buildRefinePrompt(bugs: RefineBugInput[]): { prompt: string; reportId: string } {
  const list = bugs.map((b, i) => [
    `#${i + 1}`,
    `  CUJ: ${b.feature || 'General'}`,
    `  Step: ${b.stepTitle || 'Unknown'}`,
    `  Reporter title: ${b.title.replace(/\s+/g, ' ').trim() || '(none)'}`,
    `  Reporter description: ${b.note.trim() && b.note.trim() !== b.title.trim() ? b.note.trim().replace(/\n/g, '\n    ') : '(none)'}`,
  ].join('\n')).join('\n\n');
  const reportId = `RF-${stableHash(`${REFINE_STYLE_VERSION}|${list}`)}`;
  const prompt = `You are a QA lead tidying up field-test bug reports for smart glasses (Gemini on Glasses) before they are filed in Buganizer.

Testers type quickly on a phone, so expect typos, shorthand, voice-dictation errors, missing punctuation and stray times of day. Rewrite each bug below so an engineer understands it at a glance.

BUGS (${bugs.length}):
${list}

For EVERY bug return:
- "n": its number (1, 2, ...).
- "title": one clear line, 5 to 14 words, at most ${REFINE_TITLE_MAX} characters. Say what goes wrong and where, e.g. "Keep note saves in Korean instead of English". No trailing period, no tester names, no times of day, no "[...]" prefixes (those are added later).
- "description": plain-text body, at most ${REFINE_DESCRIPTION_MAX} characters. Start with one or two plain sentences saying what happened. Then, ONLY if the reporter gave that information, add the sections "Steps to reproduce:" (numbered), "Expected:" and "Actual:". Never invent steps, causes, numbers or results the reporter did not give - if something is unknown, leave it out.

STYLE:
- Simple, natural English in active voice. Fix spelling, grammar and dictation errors.
- Keep every fact: durations, counts, quotes of what was said, app and product names, and acronyms exactly as written.
- The AI agent is always called "Gemini" (or "Gemini Live" / "GL" where the tester wrote that) - never "Assistant", "the AI" or "the bot".
- No filler or report-speak ("it was observed that", "the user experienced", "various", "it is worth noting").

Return ONLY a JSON object: {"bugs":[{"n":1,"title":"...","description":"..."}, ...]}`;
  return { prompt, reportId };
}

const clean = (v: unknown, max: number) =>
  (typeof v === 'string' ? v : '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

/** Parses RX95's reply into refinements keyed by bug id. Silently skips anything malformed. */
export function parseRefineReply(reply: string, bugs: Array<Pick<BugLog, 'id' | 'title' | 'note'>>): Record<string, RefinedBugText> {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1);
  let parsed: any;
  try { parsed = JSON.parse(body); } catch { return {}; }
  const items: any[] = Array.isArray(parsed?.bugs) ? parsed.bugs : [];
  const at = new Date().toISOString();
  const out: Record<string, RefinedBugText> = {};
  for (const it of items) {
    const n = Number(it?.n);
    if (!Number.isInteger(n) || n < 1 || n > bugs.length) continue;
    const bug = bugs[n - 1];
    const title = clean(it?.title, REFINE_TITLE_MAX).replace(/\n+/g, ' ').replace(/^\[[^\]]*\]\s*/g, '').replace(/[.]+$/, '');
    const description = clean(it?.description, REFINE_DESCRIPTION_MAX);
    if (!title || out[bug.id]) continue;
    out[bug.id] = { sig: bugTextSig(bug), title, description: description || title, at, by: 'rx95' };
  }
  return out;
}

const CACHE_KEY = 'qa_bug_refined_v1';
export function loadRefineCache(): Record<string, RefinedBugText> {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}
export function saveRefineCache(cache: Record<string, RefinedBugText>): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* storage full */ }
}

const AUTO_KEY = 'qa_rx95_auto_refine';
export const isAutoRefineOn = (): boolean => { try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch { return true; } };
export const setAutoRefineOn = (on: boolean): void => { try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch { /* ignore */ } };
