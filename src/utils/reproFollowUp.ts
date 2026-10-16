import type { BugFiled, BugLog, RefinedBugText, ReproMatches } from '../types';
import { bugTextSig } from './bugRefine';
import { MAX_SAFE_URL_LENGTH, titleFromNote } from './buganizerDraft';
import { bugTimeLabel } from './bugTime';

/**
 * Repro'd follow-ups + "Filed" stamp helpers (web only).
 *
 * Status options are now New (default) / "Repro'd Issue". "Filed" is shown by the `filed` stamp.
 * Bugs whose own stored status is the legacy 'Filed' are treated as filed ({ via: 'legacy' })
 * WITHOUT rewriting them; the stamp only becomes real data when someone changes it.
 */
export type TriageStatus = 'New' | "Repro'd Issue";
export const TRIAGE_STATUS_OPTIONS: TriageStatus[] = ['New', "Repro'd Issue"];
export const REPROD: TriageStatus = "Repro'd Issue";

/** The bug's filed stamp, including the legacy status === 'Filed' (not migrated in storage). */
export function effectiveFiled(bug: Pick<BugLog, 'filed' | 'status' | 'timestamp'>): BugFiled | undefined {
  if (bug.filed) return bug.filed;
  if (bug.status === 'Filed') return { via: 'legacy', at: bug.timestamp };
  return undefined;
}

/** Status shown in the dropdown: legacy 'Filed' and missing both show as 'New'. */
export function effectiveStatus(status?: string): TriageStatus {
  return status === REPROD ? REPROD : 'New';
}

/** Digits of a Buganizer issue id from "b/123", "123", or an issue URL. */
export function normalizeIssueId(raw: string): string {
  const s = (raw || '').trim();
  const fromUrl = /issues\/(\d+)/.exec(s);
  return (fromUrl ? fromUrl[1] : s.replace(/^b\//i, '')).replace(/[^\d]/g, '').slice(0, 12);
}

/**
 * Patch that sets or clears the stamp. Clearing a legacy stamp also sets status 'New',
 * otherwise the legacy status would bring the stamp straight back.
 */
export function filedPatch(bug: Pick<BugLog, 'status'>, filed: BugFiled | undefined): Partial<BugLog> {
  if (filed) return { filed };
  return bug.status === 'Filed' ? { filed: undefined, status: 'New' } : { filed: undefined };
}

export function newFiled(via: BugFiled['via'], issueId?: string): BugFiled {
  const id = normalizeIssueId(issueId || '');
  return { ...(id ? { issueId: id } : {}), at: new Date().toISOString(), via };
}

const VIA_LABEL: Record<BugFiled['via'], string> = { manual: '', 'follow-up': 'follow-up', new: 'filed new', legacy: 'legacy' };

/** "b/574123047 · follow-up · Oct 15" (parts that are known). */
export function filedStampLine(filed: BugFiled): string {
  const d = new Date(filed.at);
  const date = Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return [filed.issueId ? `b/${filed.issueId}` : '', VIA_LABEL[filed.via], date].filter(Boolean).join(' · ');
}

/** RX95 matches that still belong to the bug's current text. */
export function currentReproMatches(bug: BugLog): ReproMatches | undefined {
  const m = bug.reproMatches;
  return m && m.sig === bugTextSig(bug) ? m : undefined;
}

export function minutesAgo(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

export interface FollowUpContext {
  planName: string;
  /** RX95 refinement, only when it matches the bug's current text. */
  refined?: RefinedBugText;
}

/** Build lines for the follow-up comment (only what was captured). */
function buildLines(bug: BugLog): string[] {
  const e = bug.environment;
  if (!e) return ['- Builds: not captured'];
  const phone = [e.phoneManufacturer, e.phoneModel].filter(Boolean).join(' ');
  const lines: string[] = [];
  if (e.glassesFirmware) lines.push(`- Glasses firmware: ${e.glassesFirmware}`);
  const phoneParts = [phone, e.androidVersion ? `Android ${e.androidVersion}` : '', e.phoneBuild ? `build ${e.phoneBuild}` : ''].filter(Boolean);
  if (phoneParts.length) lines.push(`- Phone: ${phoneParts.join(' · ')}`);
  const apps = [e.glassesCoreVersion ? `Glasses Core: ${e.glassesCoreVersion}` : '', e.glassesCompanionVersion ? `Companion: ${e.glassesCompanionVersion}` : ''].filter(Boolean);
  if (apps.length) lines.push(`- ${apps.join(' · ')}`);
  return lines.length ? lines : ['- Builds: not captured'];
}

/** Title + description used in the comment: RX95's wording when current, else the reporter's. */
export function followUpText(bug: BugLog, refined?: RefinedBugText): { title: string; description: string } {
  if (refined && refined.sig === bugTextSig(bug)) {
    return { title: refined.title.trim(), description: (refined.description || refined.title).trim() };
  }
  const title = (bug.title || '').trim() || titleFromNote(bug.note);
  const note = (bug.note || '').trim();
  return { title, description: note && note !== title ? note : '' };
}

/** The comment pre-filled on the followed-up Buganizer issue (Markdown). */
export function buildFollowUpComment(bug: BugLog, ctx: FollowUpContext): string {
  const { title, description } = followUpText(bug, ctx.refined);
  const lines = [
    `**Reproduced in QA field testing** (${ctx.planName || bug.planId || 'Unknown plan'})`,
    '',
    '**Build**',
    ...buildLines(bug),
    '',
    `**Title:** ${title}`,
  ];
  if (description) lines.push(`**Description:** ${description}`);
  const step = bug.stepTitle ? ` · step "${bug.stepTitle}"` : '';
  lines.push('', `_${bug.testerName || 'Unknown tester'} on ${bug.deviceName || 'unknown device'} · ${bugTimeLabel(bug)}${step} · QA Manager ${bug.id}_`);
  return lines.join('\n');
}

export const issueUrl = (id: string) => `https://b.corp.google.com/issues/${encodeURIComponent(normalizeIssueId(id))}`;

/**
 * Issue URL with the comment pre-filled. If the URL would be too long, the comment in the URL is
 * shortened (the full text is always copied to the clipboard by the caller).
 */
export function followUpUrl(id: string, comment: string): { url: string; truncated: boolean } {
  const base = `${issueUrl(id)}?comment=`;
  const full = base + encodeURIComponent(comment);
  if (full.length <= MAX_SAFE_URL_LENGTH) return { url: full, truncated: false };
  const note = '\n\n(Comment shortened - the full text is on your clipboard; paste it here.)';
  let lo = 0;
  let hi = comment.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if ((base + encodeURIComponent(comment.slice(0, mid) + '…' + note)).length <= MAX_SAFE_URL_LENGTH) lo = mid; else hi = mid - 1;
  }
  return { url: base + encodeURIComponent(comment.slice(0, lo).trimEnd() + '…' + note), truncated: true };
}
