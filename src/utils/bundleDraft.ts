import type { BugBundle, BugFilePending, BugLog, BundleSuggestion, BundleSuggestionSet } from '../types';
import { DEFAULT_CC, hotlistForPlan } from '../data/buganizerCatalog';
import { type BuganizerDraft, TITLE_PREFIX, bugSourceSig, defaultComponentFor, defaultPriority, titleFromNote } from './buganizerDraft';
import { bugTimeLabel } from './bugTime';
import { effectiveFiled, followUpText } from './reproFollowUp';
import type { RefinedBugText } from '../types';

/**
 * Same-day bundles: several reports of one issue filed as ONE "mega bug".
 * A confirmed bundle is stored on every member (`bug.bundle`); the mega bug's draft is stored in the
 * per-browser drafts under the bundle id.
 */
export interface BundleGroup {
  bundle: BugBundle;
  /** Members present in the data, oldest first. */
  members: BugLog[];
}

const byTime = (a: BugLog, b: BugLog) => String(a.timestamp).localeCompare(String(b.timestamp));

/** Confirmed bundles with at least 2 members still present (a bundle that lost its members is ignored). */
export function groupBundles(bugs: BugLog[]): Map<string, BundleGroup> {
  const groups = new Map<string, BundleGroup>();
  for (const b of bugs) {
    const bd = b.bundle;
    if (!bd || !bd.id) continue;
    const g = groups.get(bd.id);
    if (!g) groups.set(bd.id, { bundle: bd, members: [b] });
    else {
      g.members.push(b);
      // Members can briefly disagree while syncing; the newest copy of the bundle wins.
      if (String(bd.at) > String(g.bundle.at)) g.bundle = bd;
    }
  }
  for (const [id, g] of groups) {
    // Only reports the bundle still lists (an edited bundle may have dropped some)
    const listed = new Set(g.bundle.memberIds);
    g.members = g.members.filter(m => listed.has(m.id)).sort(byTime);
    if (g.members.length < 2) groups.delete(id);
  }
  return groups;
}

export function newBundle(memberIds: string[], title: string, summary: string | undefined, by: BugBundle['by']): BugBundle {
  return {
    id: `bundle-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    memberIds: Array.from(new Set(memberIds)),
    title: title.replace(/\s+/g, ' ').trim() || 'Untitled bundle',
    ...(summary && summary.trim() ? { summary: summary.trim() } : {}),
    at: new Date().toISOString(),
    by,
  };
}

/** Counts of a value across members, most common first. */
export function tally(values: Array<string | undefined>): Array<{ value: string; count: number }> {
  const m = new Map<string, number>();
  values.forEach(v => { const k = (v || '').trim(); if (k) m.set(k, (m.get(k) || 0) + 1); });
  return Array.from(m.entries()).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export const bundleCuj = (members: BugLog[]) => tally(members.map(m => m.feature || 'General'))[0]?.value || 'General';

/** "BGH4.260901.003 (+1 more)" - the most common firmware, noting the others. */
export function foundInSummary(members: BugLog[]): string {
  const fw = tally(members.map(m => m.environment?.glassesFirmware));
  if (!fw.length) return '';
  return fw.length > 1 ? `${fw[0].value} (+${fw.length - 1} more)` : fw[0].value;
}

export function megaTitle(bundle: BugBundle, members: BugLog[]): string {
  return `${TITLE_PREFIX} [${bundleCuj(members)}] ${bundle.title} (reported ${members.length}×)`;
}

const cell = (s: string, max = 140) => {
  const t = (s || '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
const shortTime = (b: BugLog) => {
  const d = new Date(b.timestamp);
  return Number.isNaN(d.getTime()) ? (b.formattedTime || '') : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};
/** A member's own words for the reports table: title, plus the note when it adds something. */
export function memberReportText(b: BugLog): string {
  const t = (b.title || '').trim();
  const n = (b.note || '').trim();
  if (t && n && n !== t) return `${t}: ${n}`;
  return t || n || '(no note)';
}

function countsLine(label: string, items: Array<{ value: string; count: number }>, total: number, missing: string): string {
  if (!items.length) return `- ${label}: ${missing}`;
  if (items.length === 1 && items[0].count === total) return `- ${label}: ${items[0].value} (all)`;
  return `- ${label}: ${items.map(i => `${i.value} (${i.count} of ${total})`).join(', ')}`;
}

/** Mega-bug description: What happened / Shared across reports / Individual reports table. */
export function megaDescription(bundle: BugBundle, members: BugLog[], ctx: { planName?: string }): string {
  const n = members.length;
  const devices = new Set(members.map(m => (m.deviceName || '').trim()).filter(Boolean)).size;
  const what = (bundle.summary || bundle.title).trim();
  const steps = tally(members.map(m => m.stepTitle));
  const phones = tally(members.map(m => {
    const e = m.environment;
    if (!e) return '';
    const phone = [e.phoneManufacturer, e.phoneModel].filter(Boolean).join(' ');
    return [phone, e.androidVersion ? `Android ${e.androidVersion}` : ''].filter(Boolean).join(' · ');
  }));
  const stepPart = steps.length === 1 && steps[0].count === n ? ` · Step: ${steps[0].value}` : '';
  const lines = [
    '**What happened**',
    `${what}${/[.!?]$/.test(what) ? '' : '.'} Reported ${n}× on ${devices || n} device${(devices || n) === 1 ? '' : 's'}.`,
    '',
    '**Shared across reports**',
    `- Test plan: ${ctx.planName || members[0]?.planId || 'Unknown'}`,
    `- CUJ: ${bundleCuj(members)}${stepPart}`,
  ];
  if (!stepPart && steps.length) lines.push(countsLine('Steps', steps, n, 'unknown'));
  lines.push(countsLine('Glasses firmware', tally(members.map(m => m.environment?.glassesFirmware)), n, 'not captured'));
  lines.push(countsLine('Phone', phones, n, 'not captured'));
  lines.push('', '**Individual reports**', '| Time | Tester | Device | Report |', '|---|---|---|---|');
  members.forEach(m => lines.push(`| ${cell(shortTime(m), 20)} | ${cell(m.testerName || 'Unknown', 40)} | ${cell(m.deviceName || '?', 30)} | ${cell(memberReportText(m))} |`));
  // The RX95 worker confirms filing by searching for these IDs, so keep every one of them.
  lines.push('', `_QA Manager reports: ${members.map(m => m.id).join(', ')}_`);
  return lines.join('\n');
}

/** Changes when membership, a member's text/time or the bundle wording changes (mega draft re-generates). */
export function bundleSourceSig(bundle: BugBundle, members: BugLog[]): string {
  return [bundle.title, bundle.summary || '', ...members.map(m => `${m.id}\u0001${bugSourceSig(m)}`)].join('\u0002');
}

function highestPriority(members: BugLog[]): string {
  const ps = members.map(defaultPriority).filter(p => /^P[0-4]$/.test(p)).sort();
  return ps[0] || 'P2';
}

export function megaGenerated(group: BundleGroup, ctx: { planName?: string }): { title: string; description: string } {
  return { title: megaTitle(group.bundle, group.members), description: megaDescription(group.bundle, group.members, ctx) };
}

export function buildMegaDraft(group: BundleGroup, ctx: { planId?: string; planName?: string }): BuganizerDraft {
  const cuj = bundleCuj(group.members);
  const hotlist = hotlistForPlan(ctx.planId || group.members[0]?.planId, ctx.planName)?.hotlistId;
  return {
    bugId: group.bundle.id,
    ...megaGenerated(group, ctx),
    componentId: defaultComponentFor(cuj),
    priority: highestPriority(group.members),
    severity: '',
    type: 'BUG',
    hotlistIds: hotlist ? [hotlist] : [],
    cc: DEFAULT_CC,
    assignee: '',
    foundIn: foundInSummary(group.members),
    state: 'draft',
    sourceSig: bundleSourceSig(group.bundle, group.members),
    textEdited: false,
    updatedAt: Date.now(),
  };
}

/** Saved mega draft brought up to date (text re-generates when members/wording change, unless hand-edited). */
export function syncMegaDraft(saved: BuganizerDraft, group: BundleGroup, ctx: { planId?: string; planName?: string }): BuganizerDraft {
  const sig = bundleSourceSig(group.bundle, group.members);
  if (saved.sourceSig === sig) return saved;
  const d: BuganizerDraft = { ...saved, sourceSig: sig };
  // Membership is structural: the reports table and "reported N×" must follow it even after a hand edit.
  Object.assign(d, megaGenerated(group, ctx), { textEdited: false });
  if (!saved.foundIn || saved.foundIn === '') d.foundIn = foundInSummary(group.members);
  return d;
}

/** Synthetic bug used to run the repro matcher for a whole bundle. */
export function bundleQueryBug(group: BundleGroup): BugLog {
  const first = group.members[0];
  const notes = group.members.map(m => `- ${memberReportText(m)}`).join('\n');
  return {
    ...first,
    id: group.bundle.id,
    title: group.bundle.title,
    note: [group.bundle.summary || '', notes].filter(Boolean).join('\n'),
    feature: bundleCuj(group.members),
    reproMatches: undefined,
    refined: undefined,
    bundle: undefined,
    filed: undefined,
    filePending: undefined,
  };
}

/** Follow-up comment for a bundle: lists every report and its timestamp (each carries its QA Manager id). */
export function buildBundleFollowUpComment(group: BundleGroup, ctx: { planName: string; refinedFor?: (b: BugLog) => RefinedBugText | undefined }): string {
  const { members, bundle } = group;
  const fw = tally(members.map(m => m.environment?.glassesFirmware));
  const lines = [
    `**Reproduced in QA field testing** (${ctx.planName || members[0]?.planId || 'Unknown plan'}) · ${members.length} reports`,
    '',
    `**Summary:** ${(bundle.summary || bundle.title).trim()}`,
    '',
    '**Build**',
    fw.length ? `- Glasses firmware: ${fw.map(f => `${f.value} (${f.count} of ${members.length})`).join(', ')}` : '- Builds: not captured',
    '',
    '**Reports**',
  ];
  members.forEach(m => {
    const t = followUpText(m, ctx.refinedFor?.(m));
    lines.push(`- ${bugTimeLabel(m)} · ${m.testerName || 'Unknown tester'} on ${m.deviceName || 'unknown device'}: ${t.title}${t.description ? ` - ${cell(t.description, 300)}` : ''} (QA Manager ${m.id})`);
  });
  return lines.join('\n');
}

/** Pending filing for every member of a bundle / a single bug. */
export function pendingFor(kind: BugFilePending['kind'], opts: { issueId?: string; hotlistId?: string; bundleId?: string } = {}): BugFilePending {
  return {
    kind,
    ...(opts.issueId ? { issueId: opts.issueId } : {}),
    ...(opts.hotlistId ? { hotlistId: opts.hotlistId } : {}),
    ...(opts.bundleId ? { bundleId: opts.bundleId } : {}),
    openedAt: new Date().toISOString(),
  };
}

/** Bugs that can still be bundled: unfiled, not waiting for Buganizer, not already in a bundle. */
export const isBundleable = (b: BugLog) => !effectiveFiled(b) && !b.filePending && !b.bundle;

/**
 * Where a report gets filed: its plan's Buganizer hotlist, or (for plans with no hotlist) the plan
 * itself. Reports may only be bundled together when this key matches.
 */
export function hotlistKey(b: Pick<BugLog, 'planId'>, planName?: (id?: string) => string | undefined): string {
  const h = hotlistForPlan(b.planId, planName?.(b.planId));
  return h ? `hotlist:${h.hotlistId}` : `plan:${b.planId || ''}`;
}

/** True when every report would be filed to the same hotlist (or the same un-hotlisted plan). */
export function sameHotlist(members: Array<Pick<BugLog, 'planId'>>, planName?: (id?: string) => string | undefined): boolean {
  return new Set(members.map(m => hotlistKey(m, planName))).size <= 1;
}

export interface ShownSuggestion {
  set: BundleSuggestionSet;
  suggestion: BundleSuggestion;
  /** Members still bundleable, oldest first. */
  members: BugLog[];
  maybe: Set<string>;
}

/**
 * Suggestions worth showing: not dismissed, and still with >= 2 bundleable members (IDs RX95 didn't
 * get from the day's list, or reports filed/bundled since, are dropped). Members that would go to a
 * different hotlist than the suggestion's first member are dropped too.
 */
export function shownSuggestions(sets: BundleSuggestionSet[], bugs: BugLog[], dismissed: Set<string>, planName?: (id?: string) => string | undefined): ShownSuggestion[] {
  const byId = new Map(bugs.map(b => [b.id, b]));
  const out: ShownSuggestion[] = [];
  const used = new Set<string>();
  for (const set of sets) {
    for (const s of set.suggestions || []) {
      if (!s || dismissed.has(s.id)) continue;
      let members = Array.from(new Set(s.memberIds))
        .map(id => byId.get(id))
        .filter((b): b is BugLog => !!b && isBundleable(b) && (!set.planId || b.planId === set.planId) && !used.has(b.id))
        .sort(byTime);
      // Keep the hotlist most members go to (ties: the earliest report's)
      const keyCount = new Map<string, number>();
      members.forEach(m => { const k = hotlistKey(m, planName); keyCount.set(k, (keyCount.get(k) || 0) + 1); });
      const key = members.map(m => hotlistKey(m, planName)).reduce((best, k) => ((keyCount.get(k) || 0) > (keyCount.get(best) || 0) ? k : best), members[0] ? hotlistKey(members[0], planName) : '');
      members = members.filter(m => hotlistKey(m, planName) === key);
      if (members.length < 2) continue;
      members.forEach(m => used.add(m.id));
      out.push({ set, suggestion: s, members, maybe: new Set((s.maybeIds || []).filter(id => members.some(m => m.id === id))) });
    }
  }
  return out;
}

const DISMISSED_KEY = 'qa_bundle_dismissed_v1';
export function loadDismissed(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch { return new Set(); }
}
export function saveDismissed(ids: Set<string>): void {
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(ids))); } catch { /* ignore */ }
}

/** Default bundle title for a manual bundle: the first member's (refined) title. */
export function manualBundleTitle(members: BugLog[], refinedFor?: (b: BugLog) => RefinedBugText | undefined): string {
  const first = members[0];
  if (!first) return 'Untitled bundle';
  const r = refinedFor?.(first);
  return (r?.title || first.title || titleFromNote(first.note)).replace(/\s+/g, ' ').trim();
}
