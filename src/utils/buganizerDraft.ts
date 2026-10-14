import type { BugLog } from '../types';
import {
  CUJ_DEFAULT_COMPONENT,
  FALLBACK_COMPONENT_ID,
  PLAN_HOTLISTS,
} from '../data/buganizerCatalog';

/**
 * Buganizer triage prototype: per-bug draft fields, defaults, the prefilled new-issue URL
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
  state: DraftState;
  issueId?: string;
  updatedAt: number;
}

export interface DraftContext {
  planId?: string;
  planName?: string;
  cujName?: string;
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

/** First sentence of the tester note, tidied for a bug title. */
export function titleFromNote(note: string, max = 110): string {
  const clean = (note || '').replace(/\s+/g, ' ').trim();
  const first = clean.split(/(?<=[.!?])\s+/)[0] || clean;
  const t = first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Untitled bug';
}

export function defaultDescription(bug: BugLog, ctx: DraftContext): string {
  const lines = [
    '**What happened**',
    (bug.note || '').trim() || '(no tester note)',
    '',
    '**Where**',
    `- Test plan: ${ctx.planName || bug.planId || 'Unknown'}`,
    `- Step: ${bug.stepTitle || 'Unknown'}`,
    `- CUJ: ${ctx.cujName || bug.feature || 'General'}`,
    '',
    '**Environment**',
    `- Device: ${bug.deviceName || 'Unknown'}`,
    `- Tester: ${bug.testerName || 'Unknown'}`,
    `- Logged: ${bug.formattedTime || bug.timestamp || 'Unknown'}`,
    `- QA Manager bug ID: ${bug.id}`,
  ];
  if (bug.imageUrl) lines.push('', '_A screenshot was captured in QA Manager - attach it here if useful._');
  return lines.join('\n');
}

export function buildDefaultDraft(bug: BugLog, ctx: DraftContext): BuganizerDraft {
  const cuj = ctx.cujName || bug.feature || 'General';
  const hotlist = (ctx.planId && PLAN_HOTLISTS[ctx.planId]?.hotlistId) || (bug.planId && PLAN_HOTLISTS[bug.planId]?.hotlistId);
  return {
    bugId: bug.id,
    title: `${TITLE_PREFIX} [${cuj}] ${titleFromNote(bug.note)}`,
    description: defaultDescription(bug, { ...ctx, cujName: cuj }),
    componentId: defaultComponentFor(cuj),
    priority: defaultPriority(bug),
    severity: '',
    type: bug.bugType === 'Feature Request' ? 'FEATURE_REQUEST' : 'BUG',
    hotlistIds: hotlist ? [hotlist] : [],
    cc: '',
    assignee: '',
    state: 'draft',
    updatedAt: Date.now(),
  };
}

const usernames = (s: string) =>
  s.split(/[,\s]+/).map(u => u.trim().replace(/@google\.com$/i, '')).filter(u => /^[a-z0-9._-]{1,64}$/i.test(u));

/** Prefilled Buganizer "new issue" URL (go/buganizer/concepts/templates#supported-query-parameters). */
export function buildBuganizerUrl(d: BuganizerDraft): string {
  // Buganizer's docs ask for %20-style escaping (not "+" for spaces), so encode each value strictly.
  const params: Array<[string, string]> = [];
  const add = (k: string, v: string) => params.push([k, v]);
  if (/^\d{1,12}$/.test(d.componentId)) add('component', d.componentId);
  if (d.title.trim()) add('title', d.title.trim());
  if (d.description.trim()) {
    add('description', d.description.trim());
    add('format', 'MARKDOWN');
  }
  if (/^P[0-4]$/.test(d.priority)) add('priority', d.priority);
  if (/^S[0-4]$/.test(d.severity)) add('severity', d.severity);
  if (ALLOWED_TYPES.has(d.type)) add('type', d.type);
  // Assignee must be exactly one valid username - anything else (e.g. "john doe") is dropped, not guessed
  const assigneeRaw = d.assignee.trim().replace(/@google\.com$/i, '');
  if (/^[a-z0-9._-]{1,64}$/i.test(assigneeRaw)) add('assignee', assigneeRaw);
  const cc = usernames(d.cc).map(u => `${u}@google.com`);
  if (cc.length) add('cc', cc.join(','));
  d.hotlistIds.filter(h => /^\d{1,12}$/.test(h)).forEach(h => add('hotlistIds', h));
  const query = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `${BUGANIZER_NEW_ISSUE_URL}?${query}`;
}

export function loadDrafts(): Record<string, BuganizerDraft> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

export function saveDrafts(drafts: Record<string, BuganizerDraft>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  } catch { /* storage full - drafts stay in memory for this session */ }
}
