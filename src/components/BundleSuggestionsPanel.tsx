import React, { useState } from 'react';
import type { BugLog, TestPlan } from '../types';
import { type ShownSuggestion, bundleCuj, saveDismissed } from '../utils/bundleDraft';
import { hotlistForPlan } from '../data/buganizerCatalog';
import { minutesAgo } from '../utils/reproFollowUp';
import { titleFromNote } from '../utils/buganizerDraft';

export type BugTypeValue = 'Bug' | 'Setup Issue' | 'Known Issue' | 'Feature Request' | 'Misc Issue';
export type PriorityValue = 'P0' | 'P1' | 'P2';
export type StatusValue = 'New' | "Repro'd Issue";
export interface GroupCategory { bugType: BugTypeValue; priority: PriorityValue; status: StatusValue }

const BUG_TYPES: BugTypeValue[] = ['Bug', 'Setup Issue', 'Known Issue', 'Feature Request', 'Misc Issue'];
const PRIORITIES: PriorityValue[] = ['P0', 'P1', 'P2'];
const STATUSES: StatusValue[] = ['New', "Repro'd Issue"];

const fmtTime = (iso?: string) => {
  const d = new Date(iso || '');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};
const fmtDay = (day: string) => {
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};
const mostCommon = <T extends string>(values: T[], fallback: T): T => {
  const counts = new Map<T, number>();
  values.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
  let best = fallback; let n = 0;
  counts.forEach((c, v) => { if (c > n) { best = v; n = c; } });
  return best;
};
const priRank = (p: string) => (p === 'P0' || p === '0' ? 0 : p === 'P1' || p === '1' ? 1 : 2);
const normPri = (p?: string): PriorityValue => (priRank(p || 'P2') === 0 ? 'P0' : priRank(p || 'P2') === 1 ? 'P1' : 'P2');

/** Pre-fill: most common type, highest priority among members, Repro'd if any member is Repro'd. */
export function defaultCategory(members: BugLog[]): GroupCategory {
  const bugType = mostCommon(members.map(m => (m.bugType || 'Bug') as BugTypeValue), 'Bug');
  const priority = members.map(m => normPri(m.priority)).sort((a, b) => priRank(a) - priRank(b))[0] || 'P2';
  const status: StatusValue = members.some(m => m.status === "Repro'd Issue") ? "Repro'd Issue" : 'New';
  return { bugType, priority, status };
}

interface Props {
  /** Suggestions to show (already filtered to the feed's plan/day and hotlist-safe). */
  shown: ShownSuggestion[];
  /** Bugs with the feed's current categorization applied (for pre-fill + member chips). */
  bugsById: Map<string, BugLog>;
  plans: TestPlan[];
  dismissed: Set<string>;
  onDismissedChange: (next: Set<string>) => void;
  /** Sets the category on every member and bundles them into one bug. */
  onApply: (members: BugLog[], title: string, summary: string | undefined, cat: GroupCategory) => void;
  /** Cards hidden ("Hide suggestions"); controlled so the feed's "Review" chip can reopen them. */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

/** A suggestion's plan: from its reports (the set's planId can be empty). */
const planOf = (x: ShownSuggestion) => x.members[0]?.planId || x.set.planId;

/**
 * RX95 same-day duplicate groups on the Bugs Feed: tick the reports that are the same issue, pick one
 * Bug Type / Priority / Status for all of them, and bundle them into a single bug in one click.
 */
export default function BundleSuggestionsPanel({ shown, bugsById, plans, dismissed, onDismissedChange, onApply, collapsed, onCollapsedChange }: Props) {
  // Only the reports the user explicitly ticked/unticked; everything else uses the default (ticked unless "Unsure").
  // Stored per report (not as a whole list) so filters and partial bundles never untick hidden reports.
  const [tickOverrides, setTickOverrides] = useState<Record<string, Record<string, boolean>>>({});
  const [cats, setCats] = useState<Record<string, GroupCategory>>({});
  const planName = (id?: string) => plans.find(p => p.id === id)?.name || id || 'Unknown plan';

  if (shown.length === 0) return null;

  const reports = shown.reduce((n, x) => n + x.members.length, 0);
  const days = Array.from(new Set(shown.map(x => x.set.day)));
  const planIds = Array.from(new Set(shown.map(planOf).filter(Boolean)));
  const latest = shown.map(x => x.set.at).filter(Boolean).sort().pop();

  const dismiss = (id: string) => {
    const n = new Set(dismissed); n.add(id); saveDismissed(n); onDismissedChange(n);
  };

  return (
    <div className="space-y-3" data-testid="feed-bundle-suggestions">
      <div className="rounded-[20px] border border-violet-500/35 bg-violet-500/10 px-4 py-3 flex flex-wrap items-center gap-3 text-xs text-violet-100">
        <span className="text-base">✨</span>
        <div className="flex-1 min-w-[260px]">
          <b>RX95 found likely duplicates.</b>{' '}
          {planIds.length === 1 ? planName(planIds[0]) : `${planIds.length} test plans`} · <b>{days.length === 1 ? fmtDay(days[0]) : `${days.length} days`}</b>:{' '}
          <b>{shown.length} suggested group{shown.length === 1 ? '' : 's'}</b> ({reports} report{reports === 1 ? '' : 's'}).
          <span className="block text-violet-200/70 mt-0.5">Categorize and bundle each group once instead of setting Type / Priority / Status on every dupe.</span>
        </div>
        {latest && <span className="text-slate-400">checked {minutesAgo(latest)}</span>}
        <button type="button" data-testid="feed-bundle-toggle" onClick={() => onCollapsedChange(!collapsed)}
          className="px-3 h-8 rounded-xl font-bold bg-violet-500/20 border border-violet-500/55 text-violet-50 hover:bg-violet-500/30">
          {collapsed ? `Review ${shown.length} group${shown.length === 1 ? '' : 's'}` : 'Hide suggestions'}
        </button>
      </div>

      {!collapsed && shown.map(x => {
        const { set, suggestion: sg, members: rawMembers, maybe } = x;
        const members = rawMembers.map(m => bugsById.get(m.id) || m);
        const overrides = tickOverrides[sg.id] || {};
        const isTicked = (id: string) => overrides[id] ?? !maybe.has(id);
        const ticked = new Set(members.filter(m => isTicked(m.id)).map(m => m.id));
        const tickedMembers = members.filter(m => ticked.has(m.id));
        const cat = cats[sg.id] || defaultCategory(tickedMembers.length ? tickedMembers : members);
        const setCat = (patch: Partial<GroupCategory>) => setCats(prev => ({ ...prev, [sg.id]: { ...cat, ...patch } }));
        const setTick = (id: string, on: boolean) => setTickOverrides(prev => ({ ...prev, [sg.id]: { ...(prev[sg.id] || {}), [id]: on } }));
        const testersN = new Set(members.map(m => (m.testerName || '').trim()).filter(Boolean)).size;
        const devicesN = new Set(members.map(m => (m.deviceName || '').trim()).filter(Boolean)).size;
        const pid = planOf(x);
        const hotlist = hotlistForPlan(pid, planName(pid));
        return (
          <div key={sg.id} id={`feed-sug-${sg.id}`} data-testid="feed-bundle-suggestion" className="rounded-[20px] border border-slate-800 bg-[#111827] p-4 transition-shadow">
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="px-2 py-0.5 rounded-full border border-violet-500/50 bg-violet-500/15 text-violet-200">🧩 Likely duplicates</span>
              <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">{bundleCuj(members)}</span>
              <span className={`font-extrabold rounded-full px-2 py-0.5 border ${sg.confidence >= 80 ? 'bg-green-500/15 text-green-300 border-green-500/40' : 'bg-amber-500/15 text-amber-300 border-amber-500/40'}`}>Same issue · {Math.round(sg.confidence)}%</span>
              <span className="px-2 py-0.5 rounded-full border border-sky-500/40 bg-sky-500/10 text-sky-200" data-testid="feed-bundle-hotlist">
                {hotlist ? `Hotlist: ${hotlist.name} · ${hotlist.hotlistId}` : `No hotlist · ${planName(pid)} only`}
              </span>
              <span className="text-slate-400">{members.length} report{members.length === 1 ? '' : 's'} · {testersN} tester{testersN === 1 ? '' : 's'} · {devicesN} device{devicesN === 1 ? '' : 's'}</span>
            </div>
            <p className="text-[15px] font-extrabold text-white mt-2">{sg.title}</p>
            {sg.reason && <p className="text-xs text-slate-400 mt-0.5">Why: {sg.reason}</p>}

            <div className="mt-2 space-y-1.5">
              {members.map(m => {
                const on = ticked.has(m.id);
                const unsure = maybe.has(m.id);
                return (
                  <label key={m.id} data-testid="feed-suggestion-member" className={`flex gap-2.5 items-start rounded-xl border border-slate-700 bg-[#0b1220] px-3 py-2 cursor-pointer ${on ? '' : 'opacity-50'}`}>
                    <input type="checkbox" className="mt-0.5 accent-violet-400" checked={on} onChange={e => setTick(m.id, e.target.checked)} />
                    <span className="font-mono text-[11.5px] text-violet-300 w-[70px] flex-none">{fmtTime(m.timestamp)}</span>
                    <span className="min-w-0 flex-1">
                      <b className="text-[12.5px] text-slate-100">{m.title || titleFromNote(m.note)}</b>
                      {unsure && <span className="ml-2 text-[11px] font-extrabold rounded-full px-2 py-0.5 border bg-amber-500/15 text-amber-300 border-amber-500/40">Unsure</span>}
                      <span className="block text-[11px] text-slate-400">
                        {[m.testerName || 'Unknown', m.deviceName || '?', m.feature || 'General'].join(' · ')}
                        {m.title && (m.note || '').trim() && m.note.trim() !== m.title.trim() ? ` · "${m.note.trim().slice(0, 120)}"` : ''}{unsure ? ' · left out by default' : ''}
                      </span>
                    </span>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-full border border-slate-700 bg-slate-800 text-slate-300 flex-none">{m.bugType || 'Bug'} · {normPri(m.priority)}</span>
                  </label>
                );
              })}
            </div>

            <div className="mt-3 rounded-2xl border border-violet-500/30 bg-violet-500/[0.06] p-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-violet-200 mb-2">Categorize all {tickedMembers.length} ticked report{tickedMembers.length === 1 ? '' : 's'} as</div>
              <div className="flex flex-wrap items-end gap-2.5">
                <div>
                  <div className="text-[10px] uppercase font-mono text-slate-400 font-semibold mb-1">Bug Type</div>
                  <select data-testid="feed-bundle-type" value={cat.bugType} onChange={e => setCat({ bugType: e.target.value as BugTypeValue })}
                    className="bg-[#0f172a] border border-slate-700/80 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 font-semibold focus:outline-none focus:border-violet-500 cursor-pointer">
                    {BUG_TYPES.map(o => <option key={o} value={o} className="bg-slate-900">{o}</option>)}
                  </select>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-mono text-slate-400 font-semibold mb-1">Priority</div>
                  <select data-testid="feed-bundle-priority" value={cat.priority} onChange={e => setCat({ priority: e.target.value as PriorityValue })}
                    className="bg-[#0f172a] border border-slate-700/80 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 font-semibold focus:outline-none focus:border-violet-500 cursor-pointer">
                    {PRIORITIES.map(o => <option key={o} value={o} className="bg-slate-900">{o}</option>)}
                  </select>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-mono text-slate-400 font-semibold mb-1">Status</div>
                  <select data-testid="feed-bundle-status" value={cat.status} onChange={e => setCat({ status: e.target.value as StatusValue })}
                    className="bg-[#0f172a] border border-slate-700/80 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 font-semibold focus:outline-none focus:border-violet-500 cursor-pointer">
                    {STATUSES.map(o => <option key={o} value={o} className="bg-slate-900">{o}</option>)}
                  </select>
                </div>
                <span className="text-[11px] text-slate-500 pb-2">Pre-filled from the reports; change anything before bundling.</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-3">
              <button type="button" data-testid="feed-suggestion-bundle" disabled={tickedMembers.length < 2}
                onClick={() => {
                  onApply(tickedMembers, sg.title, sg.summary, cat);
                  // Forget this card's edits: if it ever comes back (unbundle), it pre-fills from the reports again
                  setCats(prev => { const n = { ...prev }; delete n[sg.id]; return n; });
                  setTickOverrides(prev => { const n = { ...prev }; delete n[sg.id]; return n; });
                }}
                className="px-3 h-8 rounded-xl text-xs font-bold bg-violet-500/25 border border-violet-500/60 text-violet-50 hover:bg-violet-500/35 disabled:opacity-40 disabled:cursor-not-allowed">
                🧩 Categorize &amp; bundle {tickedMembers.length} report{tickedMembers.length === 1 ? '' : 's'}
              </button>
              <button type="button" data-testid="feed-suggestion-dismiss" onClick={() => dismiss(sg.id)}
                className="px-3 h-8 rounded-xl text-xs font-semibold border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700">
                Not the same issue
              </button>
              <span className="text-[11px] text-slate-500 ml-auto">Only reports going to the same hotlist can be bundled · nothing is filed until you open it from the Buganizer tab</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
