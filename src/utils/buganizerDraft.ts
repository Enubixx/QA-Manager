import type { BugLog, RefinedBugText } from '../types';
import { bugTimeLabel } from './bugTime';
import {
  CUJ_DEFAULT_COMPONENT,
  DEFAULT_CC,
  FALLBACK_COMPONENT_ID,
  hotlistForPlan,
} from '../data/buganizerCatalog';

/**
 * Buganizer triage: per-bug draft fields, defaults, the prefilled new-issue URL
 * builder, and local-only storage. Nothing here talks to Buganizer - it only builds
 * https://b.corp.google.com/issues/new?... links, which never create a bug on their own
 * (a person must review the form and click Create).
 */
export type DraftState = 'draft' | 'ready' | 'opened' | 'filed';

export interface BuganizerDraft {
  bugId: string;
  title: string;
  description: string;
  componentId: string;
  priority: string;
  severity: string;
  type: string;
  hotlistIds: string[];
  cc: string;
  assignee: string;
  /** Buganizer "Found in" (defaults to the glasses firmware build). */
  foundIn: string;
  state: DraftState;
  issueId?: string;
  /** Fingerprint of the bug's title + note when the draft text was generated (re-sync after Bugs Feed edits). */
  sourceSig?: string;
  /** True once someone edits the title/description in the Buganizer tab (RX95 then leaves them alone). */
  textEdited?: boolean;
  /** `at` of the RX95 refinement currently applied to title/description, if any. */
  refinedAt?: string;
  /** "Repro'd Issue" bugs: the user chose "None of these: file as new bug" (show the new-issue draft instead of RX95 matches). */
  fileAsNew?: boolean;
  /** Mega bugs: "Check hotlist for an existing bug" was clicked (show RX95's possible existing bugs). */
  reproCheck?: boolean;
  updatedAt: number;
}

export interface DraftContext {
  planId?: string;
  planName?: string;
  cujName?: string;
  /** RX95's cleaned-up wording for this bug (only when it matches the bug's current text). */
  refined?: RefinedBugText;
}

export const BUGANIZER_NEW_ISSUE_URL = 'https://b.corp.google.com/issues/new';
/** Browsers and Buganizer get unreliable with very long URLs; warn above this. */
export const MAX_SAFE_URL_LENGTH = 7500;
export const TITLE_PREFIX = '[Gemini on Glasses]';
const STORAGE_KEY = 'qa_buganizer_drafts_v1';
/** Issue types Buganizer accepts in a prefilled URL. */
const ALLOWED_TYPES = new Set(['BUG', 'FEATURE_REQUEST', 'CUSTOMER_ISSUE', 'INTERNAL_CLEANUP', 'PROCESS', 'VULNERABILITY']);

const PRIORITY_FROM_SEVERITY: Record<string, string> = { critical: 'P0', high: 'P1', medium: 'P2', low: 'P3' };

export function defaultPriority(bug: BugLog): string {
  const p = String(bug.priority ?? '').toUpperCase().replace(/^(\d)$/, 'P$1');
  if (/^P[0-4]$/.test(p)) return p;
  return PRIORITY_FROM_SEVERITY[String(bug.severity || '').toLowerCase()] || 'P2';
}

export function defaultComponentFor(cujName?: string): string {
  if (!cujName) return FALLBACK_COMPONENT_ID;
  const key = cujName.trim().toLowerCase();
  const hit = Object.entries(CUJ_DEFAULT_COMPONENT).find(([k]) => k.toLowerCase() === key);
  return hit ? hit[1] : FALLBACK_COMPONENT_ID;
}

/** Replace lone UTF-16 surrogates (e.g. half an emoji) with U+FFFD so encodeURIComponent can never throw. */
export function toWellFormedText(s: string): string {
  return (s || '').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

/** encodeURIComponent that never throws `URIError: URI malformed` on lone surrogates. */
export const safeEncodeURIComponent = (s: string): string => encodeURIComponent(toWellFormedText(s));

/** Slice by code points so emoji / surrogate pairs are never split in half. */
export function sliceCodePoints(s: string, start: number, end?: number): string {
  return Array.from(s || '').slice(start, end).join('');
}

const ABBREV_END_RE = /\b(?:e\.g|i\.e|vs|v|mr|mrs|ms|dr|st|etc|approx|cf|fig|no|vol|inc|ltd|co|[a-z])\.$/i;

/** First sentence of the tester note, tidied for a bug title (never splits on abbreviations like e.g. / i.e. / vs. / v1.2). */
export function titleFromNote(note: string, max = 110): string {
  const clean = (note || '').replace(/\s+/g, ' ').trim();
  let first = clean;
  const re = /[.!?]\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const punct = m[0][0];
    const upToPunct = clean.slice(0, m.index + 1);
    if (punct === '.' && (ABBREV_END_RE.test(upToPunct) || /\d\.$/.test(upToPunct))) {
      continue;
    }
    first = upToPunct;
    break;
  }
  const t = Array.from(first).length > max ? `${sliceCodePoints(first, 0, max - 1).trimEnd()}…` : first;
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Untitled bug';
}

/** Build lines for the Environment section (only what was captured; "Not captured" otherwise). */
export function environmentLines(bug: BugLog): string[] {
  const e = bug.environment;
  if (!e) return ['- Builds: not captured (log the bug from the QA Tester app with the glasses build scanned)'];
  const phone = [e.phoneManufacturer, e.phoneModel].filter(Boolean).join(' ');
  return [
    `- Glasses firmware: ${e.glassesFirmware || 'not captured'}${e.glassesSerial ? ` · serial ${e.glassesSerial}` : ''}`,
    `- Phone: ${phone || 'unknown'}${e.androidVersion ? ` · Android ${e.androidVersion}` : ''}${e.phoneBuild ? ` · build ${e.phoneBuild}` : ''}`,
    `- Glasses Core: ${e.glassesCoreVersion || 'not installed'}`,
    `- Glasses Companion: ${e.glassesCompanionVersion || 'not installed'}`,
  ];
}

export function defaultDescription(bug: BugLog, ctx: DraftContext): string {
  const original = (bug.note || '').trim() || (bug.title || '').trim() || '(no tester note)';
  const lines = [
    '**What happened**',
    ctx.refined ? ctx.refined.description.trim() || ctx.refined.title : original,
    '',
    '**Where**',
    `- Test plan: ${ctx.planName || bug.planId || 'Unknown'}`,
    `- Step: ${bug.stepTitle || 'Unknown'}`,
    `- CUJ: ${ctx.cujName || bug.feature || 'General'}`,
    '',
    '**Environment**',
    ...environmentLines(bug),
    '',
    `_Logged by ${bug.testerName || 'Unknown'} on ${bug.deviceName || 'Unknown device'} · ${bugTimeLabel(bug)} · QA Manager ${bug.id}_`,
  ];
  if (bug.imageUrl) lines.push('', '_A screenshot was captured in QA Manager - attach it here if useful._');
  if (ctx.refined) {
    const t = (bug.title || '').trim();
    const n = (bug.note || '').trim();
    const quoted = [t && `**${t}**`, n && n !== t ? n : ''].filter(Boolean).join('\n').split('\n').map(l => `> ${l}`).join('\n');
    lines.push('', '**Reporter\'s original note**', quoted || '> (none)');
  }
  return lines.join('\n');
}

export function buildDefaultDraft(bug: BugLog, ctx: DraftContext): BuganizerDraft {
  const cuj = ctx.cujName || bug.feature || 'General';
  const hotlist = hotlistForPlan(ctx.planId || bug.planId, ctx.planName)?.hotlistId;
  return {
    bugId: bug.id,
    title: defaultTitle(bug, cuj, ctx.refined),
    description: defaultDescription(bug, { ...ctx, cujName: cuj }),
    componentId: defaultComponentFor(cuj),
    priority: defaultPriority(bug),
    severity: '',
    type: bug.bugType === 'Feature Request' ? 'FEATURE_REQUEST' : 'BUG',
    hotlistIds: hotlist ? [hotlist] : [],
    cc: DEFAULT_CC,
    assignee: '',
    foundIn: bug.environment?.glassesFirmware || '',
    state: 'draft',
    sourceSig: bugSourceSig(bug),
    textEdited: false,
    refinedAt: ctx.refined?.at,
    updatedAt: Date.now(),
  };
}

export function defaultTitle(bug: BugLog, cuj: string, refined?: RefinedBugText): string {
  const rawCore = (refined?.title || bug.title || '').replace(/\s+/g, ' ').trim();
  const strippedCore = rawCore.replace(/^(?:\[[^\]]{1,60}\]\s*)+/, '').trim();
  const core = strippedCore || rawCore || titleFromNote(bug.note);
  return `${TITLE_PREFIX} [${cuj}] ${core}`;
}

/** Draft title + description as generated from the bug (RX95 wording when `useRefined` and available). */
export function generatedText(bug: BugLog, ctx: DraftContext, useRefined = true): { title: string; description: string } {
  const cuj = ctx.cujName || bug.feature || 'General';
  const c = { ...ctx, cujName: cuj, refined: useRefined ? ctx.refined : undefined };
  return { title: defaultTitle(bug, cuj, c.refined), description: defaultDescription(bug, c) };
}

/** Changes whenever the tester's title or description is edited (never includes time, so adjusting time doesn't wipe drafts). */
export function bugSourceSig(bug: BugLog): string {
  return `${(bug.title || '').trim()}\u0000${(bug.note || '').trim()}`;
}

/**
 * Bring a saved draft up to date: re-generate title/description when the bug itself was
 * edited since the draft was made (unless the user hand-edited the draft in Buganizer tab),
 * fill Found in when empty and firmware becomes available, and fill default hotlist/CC for older drafts.
 */
export function syncDraftWithBug(saved: BuganizerDraft, bug: BugLog, ctx: DraftContext): BuganizerDraft {
  const fw = (bug.environment?.glassesFirmware || '').trim();
  const savedFoundIn = (saved.foundIn || '').trim();
  const d: BuganizerDraft = {
    ...saved,
    foundIn: savedFoundIn || fw,
  };
  const sig = bugSourceSig(bug);
  // Normalize older sourceSigs that appended a 3rd time segment
  const prevSig = saved.sourceSig !== undefined ? saved.sourceSig.split('\u0000').slice(0, 2).join('\u0000') : undefined;
  const textChanged = prevSig !== undefined && prevSig !== sig;
  // Drafts saved before `textEdited` existed: treat them as edited unless they still match the generated text.
  const edited = saved.textEdited ?? (() => {
    const plain = generatedText(bug, ctx, false);
    const withRefined = generatedText(bug, ctx, true);
    return (
      (saved.title !== plain.title || saved.description !== plain.description) &&
      (saved.title !== withRefined.title || saved.description !== withRefined.description)
    );
  })();
  if (edited) {
    // A draft with textEdited:true is never overwritten silently.
    d.textEdited = true;
  } else if (textChanged) {
    // Reporter's own text changed in Bugs Feed and draft was not hand-edited in Buganizer tab.
    Object.assign(d, generatedText(bug, ctx), { textEdited: false, refinedAt: ctx.refined?.at });
  } else if (ctx.refined && saved.refinedAt !== ctx.refined.at) {
    // New RX95 wording arrived and nobody has hand-edited this draft's text.
    Object.assign(d, generatedText(bug, ctx), { textEdited: false, refinedAt: ctx.refined.at });
  } else {
    // Keep unedited generated text in sync with latest time label / environment / CUJ.
    Object.assign(d, generatedText(bug, ctx, Boolean(saved.refinedAt && ctx.refined)), { textEdited: false });
  }
  if (saved.sourceSig === undefined) {
    // Draft predates hotlist/CC defaults: fill them only if they were left blank.
    if (!d.hotlistIds?.length) {
      const h = hotlistForPlan(ctx.planId || bug.planId, ctx.planName)?.hotlistId;
      d.hotlistIds = h ? [h] : [];
    }
    if (!(d.cc || '').trim()) d.cc = DEFAULT_CC;
  }
  d.sourceSig = sig;
  return d;
}

const usernames = (s: string) =>
  (s || '').split(/[,\s]+/).map(u => u.trim().replace(/@google\.com$/i, '')).filter(u => /^[a-z0-9._-]{1,64}$/i.test(u));

/** Prefilled Buganizer "new issue" URL (go/buganizer/concepts/templates#supported-query-parameters). */
export function buildBuganizerUrl(d: Partial<BuganizerDraft>): string {
  // Buganizer's docs ask for %20-style escaping (not "+" for spaces), so encode each value strictly.
  const params: Array<[string, string]> = [];
  const add = (k: string, v: string) => params.push([k, v]);
  const componentId = String(d?.componentId || '');
  const title = String(d?.title || '').trim();
  const description = String(d?.description || '').trim();
  const priority = String(d?.priority || '');
  const severity = String(d?.severity || '');
  const type = String(d?.type || '');
  const assignee = String(d?.assignee || '').trim().replace(/@google\.com$/i, '');
  const hotlistIds = Array.isArray(d?.hotlistIds) ? d.hotlistIds : [];

  if (/^\d{1,12}$/.test(componentId)) add('component', componentId);
  if (title) add('title', title);
  if (description) {
    add('description', description);
    add('format', 'MARKDOWN');
  }
  if (/^P[0-4]$/.test(priority)) add('priority', priority);
  if (/^S[0-4]$/.test(severity)) add('severity', severity);
  if (ALLOWED_TYPES.has(type)) add('type', type);
  // Assignee must be exactly one valid username - anything else (e.g. "john doe") is dropped, not guessed
  if (/^[a-z0-9._-]{1,64}$/i.test(assignee)) add('assignee', assignee);
  const cc = usernames(String(d?.cc || '')).map(u => `${u}@google.com`);
  if (cc.length) add('cc', cc.join(','));
  hotlistIds.filter(h => /^\d{1,12}$/.test(String(h || ''))).forEach(h => add('hotlistIds', String(h)));
  const foundIn = sliceCodePoints(String(d?.foundIn || '').replace(/[\r\n]+/g, ' ').trim(), 0, 200);
  if (foundIn) add('foundIn', foundIn);
  const query = params.map(([k, v]) => `${k}=${safeEncodeURIComponent(v)}`).join('&');
  return `${BUGANIZER_NEW_ISSUE_URL}?${query}`;
}

export function loadDrafts(): Record<string, BuganizerDraft> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

export function saveDrafts(drafts: Record<string, BuganizerDraft>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  } catch { /* storage full */ }
}
