import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bug, CheckCircle2, Copy, ExternalLink, Eye, Filter, Repeat, Search, ShieldCheck, Sparkles, X } from 'lucide-react';
import type { BugFilePending, BugLog, RefinedBugText, ReproCandidate, ReproMatches, TestPlan } from '../types';
import type { Rx95SuggestionsData } from '../services/supabaseService';
import {
  type BundleGroup,
  buildBundleFollowUpComment,
  buildMegaDraft,
  bundleCuj,
  bundleQueryBug,
  groupBundles,
  isBundleable,
  loadDismissed,
  manualBundleTitle,
  memberReportText,
  newBundle,
  pendingFor,
  saveDismissed,
  shownSuggestions,
  syncMegaDraft,
} from '../utils/bundleDraft';
import { isRx95Available, requestRx95Match, requestRx95Refine } from '../services/rx95Service';
import {
  REPROD,
  buildFollowUpComment,
  currentReproMatches,
  effectiveFiled,
  effectiveStatus,
  filedStampLine,
  followUpUrl,
  issueUrl,
  minutesAgo,
  newFiled,
} from '../utils/reproFollowUp';
import { bugTextSig, currentRefinement, isAutoRefineOn, loadRefineCache, saveRefineCache, setAutoRefineOn } from '../utils/bugRefine';
import {
  BUGANIZER_COMPONENTS,
  BUGANIZER_PRIORITIES,
  BUGANIZER_TYPES,
  KNOWN_HOTLISTS,
  hotlistForPlan,
  TOP_COMPONENT_COUNT,
  componentById,
} from '../data/buganizerCatalog';
import {
  type BuganizerDraft,
  type DraftState,
  MAX_SAFE_URL_LENGTH,
  buildBuganizerUrl,
  buildDefaultDraft,
  generatedText,
  loadDrafts,
  syncDraftWithBug,
  saveDrafts,
  titleFromNote,
} from '../utils/buganizerDraft';

/**
 * Buganizer triage view.
 * Categorize QA app bugs for Buganizer, review/edit them in a "Ready to file" queue, then open
 * one prefilled Buganizer new-issue tab per bug. Drafts live in this browser's localStorage only.
 * Nothing is sent to Buganizer: the prefilled form only creates a bug if a person clicks Create.
 */
interface Props {
  bugs: BugLog[];
  plans: TestPlan[];
  /** Saves RX95 refinements onto the bugs (so every device sees them). Optional - falls back to this browser only. */
  /**
   * Persists RX95 refinements on the bugs. The handler (App) sets only `refined`, and only on bugs
   * whose current text still matches each refinement's sig, so replies that land after an edit
   * (even after this view unmounted) never overwrite it.
   */
  onApplyRefinements?: (refinements: Record<string, RefinedBugText>) => void;
  /** Merges a patch into the CURRENT copy of a bug (used for the Filed stamp). */
  onPatchBugLog?: (bugId: string, patch: Partial<BugLog>) => void;
  /** Persists RX95 repro matches (App sets only `reproMatches`, and only while the bug text matches `sig`). */
  onApplyReproMatches?: (matches: Record<string, ReproMatches>) => void;
  /** Merges patches into the CURRENT copies of several bugs (bundles, filing a mega bug). */
  onPatchBugLogs?: (patches: Record<string, Partial<BugLog>>) => void;
  /** RX95 worker output (read-only): same-day bundle suggestions + background heartbeat. */
  rx95Suggestions?: Rx95SuggestionsData;
}

/** The RX95 worker counts as running while its heartbeat is younger than this. */
const WORKER_FRESH_SEC = 90;
const fmtTime = (iso?: string) => {
  const d = new Date(iso || '');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};
const fmtDay = (day: string) => {
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/** Max RX95 repro checks one page visit makes on its own (one bug per request). */
const MAX_AUTO_MATCHES = 10;
const VERDICT_LABEL: Record<ReproCandidate['verdict'], string> = { very_likely: 'Very likely', possible: 'Possible', unlikely: 'Unlikely' };
const VERDICT_STYLE: Record<ReproCandidate['verdict'], string> = {
  very_likely: 'bg-green-500/15 text-green-300 border-green-500/40',
  possible: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  unlikely: 'bg-slate-500/20 text-slate-300 border-slate-600',
};

/** Max RX95 refine requests one page visit will make on its own (each covers up to 25 bugs). */
const MAX_AUTO_REFINE_BATCHES = 4;

const STATE_LABEL: Record<DraftState, string> = { draft: 'Draft', ready: 'Ready to file', opened: 'Opened in Buganizer', filed: 'Filed' };
const STATE_STYLE: Record<DraftState, string> = {
  draft: 'bg-slate-700/60 text-slate-300 border-slate-600',
  ready: 'bg-blue-600/20 text-blue-200 border-blue-500/50',
  opened: 'bg-amber-500/15 text-amber-200 border-amber-500/40',
  filed: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40',
};
const localDay = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const inputCls = 'w-full bg-[#0f172a] border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500';
const labelCls = 'block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1';

const topComponents = BUGANIZER_COMPONENTS.slice(0, TOP_COMPONENT_COUNT);
const otherComponents = BUGANIZER_COMPONENTS.slice(TOP_COMPONENT_COUNT).sort((a, b) => a.name.localeCompare(b.name));
const pathTail = (path: string) => path.split(' > ').slice(-2, -1)[0] || '';

export default function BuganizerTriage({ bugs, plans, onApplyRefinements, onPatchBugLog, onApplyReproMatches, onPatchBugLogs, rx95Suggestions }: Props) {
  const planName = (id?: string) => plans.find(p => p.id === id)?.name || id || 'Unknown plan';
  const [drafts, setDrafts] = useState<Record<string, BuganizerDraft>>(() => loadDrafts());
  const [tester, setTester] = useState('all');
  const [planId, setPlanId] = useState('all');
  const [day, setDay] = useState('');
  const [cuj, setCuj] = useState('all');
  const [stateFilter, setStateFilter] = useState<'all' | DraftState>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [preview, setPreview] = useState<BuganizerDraft[] | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState<Set<string>>(new Set());
  const [allowOpen, setAllowOpen] = useState(false);
  const [openQueue, setOpenQueue] = useState<BuganizerDraft[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => saveDrafts(drafts), [drafts]);

  // RX95 refinements: on the bug itself when synced, plus a per-browser cache.
  const [refineCache, setRefineCache] = useState<Record<string, RefinedBugText>>(() => loadRefineCache());
  useEffect(() => saveRefineCache(refineCache), [refineCache]);
  const [autoRefine, setAutoRefine] = useState<boolean>(() => isAutoRefineOn());
  const [refineState, setRefineState] = useState<{ running: number; done: number; error?: string }>({ running: 0, done: 0 });
  const refineAttempted = useRef<Set<string>>(new Set());
  const refineBatches = useRef(0);
  const refineBusy = useRef(false);
  const [refineTick, setRefineTick] = useState(0);
  const rx95Ready = isRx95Available();
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  // Latest handler, so a reply that arrives after unmount still reaches App's sig-guarded apply.
  const applyRef = useRef(onApplyRefinements);
  applyRef.current = onApplyRefinements;
  const applyMatchesRef = useRef(onApplyReproMatches);
  applyMatchesRef.current = onApplyReproMatches;

  // Filed bugs (stamp, follow-up, "Filed as b/", or legacy status 'Filed') are hidden unless shown.
  const [showFiled, setShowFiled] = useState(false);
  // RX95 repro matches: results also kept here so they show even before App persists them.
  const [matchCache, setMatchCache] = useState<Record<string, ReproMatches>>({});
  const [matchState, setMatchState] = useState<Record<string, { running?: boolean; error?: string }>>({});
  const [matchPaused, setMatchPaused] = useState<string | undefined>();
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [commentOpen, setCommentOpen] = useState<Set<string>>(new Set());
  const matchAttempted = useRef<Set<string>>(new Set());
  const matchBusy = useRef(false);
  const matchCount = useRef(0);
  const [matchTick, setMatchTick] = useState(0);

  // Same-day bundles
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed());
  const [ticks, setTicks] = useState<Record<string, string[]>>({});
  const [editingBundle, setEditingBundle] = useState<{ id: string; keep: Set<string> } | null>(null);
  const [waitingIssue, setWaitingIssue] = useState<Record<string, string>>({});

  // RX95 background worker heartbeat: fresh => the in-tab auto engines stay off (fallback only).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNowMs(Date.now()), 10000); return () => clearInterval(t); }, []);
  const heartbeat = rx95Suggestions?.heartbeat;
  const hbAgeSec = heartbeat ? Math.max(0, (nowMs - new Date(heartbeat.at).getTime()) / 1000) : Infinity;
  const workerFresh = Number.isFinite(hbAgeSec) && hbAgeSec < WORKER_FRESH_SEC;

  const refinedFor = (bug: BugLog) => currentRefinement(bug, refineCache);
  const ctxFor = (bug: BugLog) => ({ planId: bug.planId, planName: planName(bug.planId), cujName: bug.feature || 'General', refined: refinedFor(bug) });
  const draftFromStore = (store: Record<string, BuganizerDraft>, bug: BugLog): BuganizerDraft =>
    store[bug.id] ? syncDraftWithBug(store[bug.id], bug, ctxFor(bug)) : buildDefaultDraft(bug, ctxFor(bug));
  const draftFor = (bug: BugLog): BuganizerDraft => draftFromStore(drafts, bug);

  const updateDraft = (bug: BugLog, patch: Partial<BuganizerDraft>) => {
    // Hand edits to the text mean RX95 must leave this draft's title/description alone.
    const textPatch = ('title' in patch || 'description' in patch) && !('textEdited' in patch) ? { textEdited: true } : {};
    setDrafts(prev => ({ ...prev, [bug.id]: { ...draftFromStore(prev, bug), ...patch, ...textPatch, updatedAt: Date.now() } }));
  };
  const useOriginalWording = (bug: BugLog) => updateDraft(bug, { ...generatedText(bug, ctxFor(bug), false), textEdited: true });
  const useRx95Wording = (bug: BugLog) => {
    const r = refinedFor(bug);
    if (r) updateDraft(bug, { ...generatedText(bug, ctxFor(bug), true), textEdited: false, refinedAt: r.at });
  };

  const testers = useMemo(() => Array.from(new Set(bugs.map(b => (b.testerName || '').trim()).filter(Boolean))).sort(), [bugs]);
  const cujs = useMemo(() => Array.from(new Set(bugs.map(b => b.feature || 'General'))).sort(), [bugs]);
  const planIds = useMemo(() => Array.from(new Set(bugs.map(b => b.planId).filter(Boolean))), [bugs]);

  const isFiled = (b: BugLog) => !!effectiveFiled(b);
  /** "Repro'd Issue" bugs show RX95's possible existing bugs instead of a new-issue draft. */
  const isReproRow = (b: BugLog) => !isFiled(b) && effectiveStatus(b.status) === REPROD && !draftFor(b).fileAsNew;
  const matchesFor = (b: BugLog): ReproMatches | undefined => {
    const onBug = currentReproMatches(b);
    const local = matchCache[b.id];
    const localOk = local && local.sig === bugTextSig(b) ? local : undefined;
    if (onBug && localOk) return localOk.at > onBug.at ? localOk : onBug;
    return onBug || localOk;
  };

  const groups = useMemo(() => groupBundles(bugs), [bugs]);
  const bundledIds = useMemo(() => new Set(Array.from(groups.values()).flatMap(g => g.members.map(m => m.id))), [groups]);
  /** Opened in Buganizer, not yet confirmed (shown in the "Waiting" group instead of the list). */
  const isPending = (b: BugLog) => !!b.filePending && !isFiled(b);
  const passesBase = (b: BugLog) =>
    (tester === 'all' || (b.testerName || '').trim().toLowerCase() === tester.toLowerCase())
    && (planId === 'all' || b.planId === planId)
    && (!day || localDay(b.timestamp) === day)
    && (cuj === 'all' || (b.feature || 'General') === cuj);

  /** Everything matching the filters, filed or not (bundle members and waiting bugs are shown elsewhere). */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bugs
      .filter(b => (b.note || '').trim())
      .filter(b => !bundledIds.has(b.id) && !isPending(b))
      .filter(b => tester === 'all' || (b.testerName || '').trim().toLowerCase() === tester.toLowerCase())
      .filter(b => planId === 'all' || b.planId === planId)
      .filter(b => !day || localDay(b.timestamp) === day)
      .filter(b => cuj === 'all' || (b.feature || 'General') === cuj)
      .filter(b => stateFilter === 'all' || draftFor(b).state === stateFilter)
      .filter(b => !q || `${b.note} ${b.stepTitle} ${draftFor(b).title}`.toLowerCase().includes(q))
      .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bugs, tester, planId, day, cuj, stateFilter, query, drafts, bundledIds]);

  // Mega-bug drafts (stored under the bundle id)
  const megaCtx = (g: BundleGroup) => ({ planId: g.members[0]?.planId, planName: planName(g.members[0]?.planId) });
  const megaDraftFrom = (store: Record<string, BuganizerDraft>, g: BundleGroup): BuganizerDraft =>
    store[g.bundle.id] ? syncMegaDraft(store[g.bundle.id], g, megaCtx(g)) : buildMegaDraft(g, megaCtx(g));
  const megaDraftFor = (g: BundleGroup) => megaDraftFrom(drafts, g);
  const updateMega = (g: BundleGroup, patch: Partial<BuganizerDraft>) => {
    const textPatch = ('title' in patch || 'description' in patch) && !('textEdited' in patch) ? { textEdited: true } : {};
    setDrafts(prev => ({ ...prev, [g.bundle.id]: { ...megaDraftFrom(prev, g), ...patch, ...textPatch, updatedAt: Date.now() } }));
  };
  const groupIsFiled = (g: BundleGroup) => g.members.every(isFiled);
  const groupHasReprod = (g: BundleGroup) => g.members.some(m => !isFiled(m) && effectiveStatus(m.status) === REPROD);
  /** Bundle shows RX95's possible existing bugs (Repro'd member, or "Check hotlist" clicked). */
  const isReproGroup = (g: BundleGroup) => {
    const d = megaDraftFor(g);
    return !groupIsFiled(g) && !d.fileAsNew && (groupHasReprod(g) || !!d.reproCheck);
  };
  const groupMatches = (g: BundleGroup): ReproMatches | undefined => {
    const q = bundleQueryBug(g);
    const local = matchCache[g.bundle.id];
    if (local && local.sig === bugTextSig(q)) return local;
    // Until the bundle itself is checked, reuse a Repro'd member's matches (the worker checks those).
    for (const m of g.members) { const mm = effectiveStatus(m.status) === REPROD ? matchesFor(m) : undefined; if (mm) return mm; }
    return undefined;
  };
  const visibleGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Array.from(groups.values())
      .filter(g => !g.members.some(isPending))
      .filter(g => g.members.some(passesBase))
      .filter(g => stateFilter === 'all' || megaDraftFor(g).state === stateFilter)
      .filter(g => !q || `${g.bundle.title} ${g.members.map(m => `${m.note} ${m.title || ''} ${m.stepTitle}`).join(' ')}`.toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, tester, planId, day, cuj, stateFilter, query, drafts]);
  const filedGroups = visibleGroups.filter(groupIsFiled);
  const shownGroups = showFiled ? visibleGroups : visibleGroups.filter(g => !groupIsFiled(g));

  /** "Waiting for Buganizer": single bugs, and bundles (grouped by bundle id). */
  const waitingEntries = useMemo(() => {
    const out: Array<{ key: string; pending: BugFilePending; members: BugLog[]; group?: BundleGroup }> = [];
    const seen = new Set<string>();
    bugs.filter(b => isPending(b) && passesBase(b)).sort((a, b) => String(b.filePending!.openedAt).localeCompare(String(a.filePending!.openedAt))).forEach(b => {
      const p = b.filePending!;
      const g = p.bundleId ? groups.get(p.bundleId) : undefined;
      const key = g ? g.bundle.id : b.id;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ key, pending: p, members: g ? g.members.filter(isPending) : [b], group: g });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bugs, groups, tester, planId, day, cuj]);
  const waitingCount = bugs.filter(isPending).length;

  const filedCount = useMemo(() => filtered.filter(isFiled).length + filedGroups.reduce((n, g) => n + g.members.length, 0), [filtered, filedGroups]);
  const visible = useMemo(() => (showFiled ? filtered : filtered.filter(b => !isFiled(b))), [filtered, showFiled]);
  const reproRows = visible.filter(isReproRow);

  const counts = useMemo(() => {
    const c: Record<DraftState, number> = { draft: 0, ready: 0, opened: 0, filed: 0 };
    visible.forEach(b => { c[draftFor(b).state]++; });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, drafts]);

  // Background RX95 refinement of the reporter's wording (newest visible bugs first).
  useEffect(() => {
    // The RX95 background worker does this when it's running; the in-tab engine is only the fallback.
    if (workerFresh || !autoRefine || !rx95Ready || refineBusy.current || refineBatches.current >= MAX_AUTO_REFINE_BATCHES) return;
    const key = (b: BugLog) => `${b.id}|${bugTextSig(b)}`;
    const todo = visible.filter(b => !refinedFor(b) && !refineAttempted.current.has(key(b))).slice(0, 25);
    if (todo.length === 0) return;
    todo.forEach(b => refineAttempted.current.add(key(b)));
    refineBusy.current = true;
    refineBatches.current += 1;
    setRefineState(s => ({ ...s, running: todo.length, error: undefined }));
    const signal = { cancelled: false };
    requestRx95Refine(todo, signal)
      .then(result => {
        const ids = Object.keys(result);
        if (ids.length === 0) return;
        // Per-browser cache (entries are sig-guarded, so stale ones are simply never used).
        if (mountedRef.current) setRefineCache(prev => ({ ...prev, ...result }));
        else saveRefineCache({ ...loadRefineCache(), ...result });
        // Never send bug objects from here: App applies only `refined`, checked against the CURRENT text.
        applyRef.current?.(result);
        setRefineState(s => ({ ...s, done: s.done + ids.length }));
      })
      .catch(err => setRefineState(s => ({ ...s, error: String(err?.message || err) })))
      .finally(() => {
        refineBusy.current = false;
        setRefineState(s => ({ ...s, running: 0 }));
        setRefineTick(t => t + 1);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, autoRefine, rx95Ready, refineTick, workerFresh]);

  const retryRefine = () => {
    refineAttempted.current.clear();
    refineBatches.current = 0;
    setRefineState(s => ({ ...s, error: undefined }));
    setRefineTick(t => t + 1);
  };
  const toggleAutoRefine = () => {
    const next = !autoRefine;
    setAutoRefine(next);
    setAutoRefineOn(next);
    if (next) retryRefine();
  };
  const refinedVisible = visible.filter(b => refinedFor(b)).length;

  /** Ask RX95 for possible existing bugs (auto: one at a time, newest first; manual: re-check). */
  const runMatch = (bug: BugLog, auto: boolean) => {
    matchAttempted.current.add(`${bug.id}|${bugTextSig(bug)}`);
    if (auto) { matchBusy.current = true; matchCount.current += 1; }
    setMatchState(s => ({ ...s, [bug.id]: { running: true } }));
    requestRx95Match(bug, bug.planId, { cancelled: false })
      .then(m => {
        // App applies only `reproMatches`, checked against the bug's CURRENT text (never a stale copy).
        applyMatchesRef.current?.({ [bug.id]: m });
        if (mountedRef.current) {
          setMatchCache(prev => ({ ...prev, [bug.id]: m }));
          setMatchState(s => ({ ...s, [bug.id]: {} }));
        }
      })
      .catch(err => {
        if (!mountedRef.current) return;
        const msg = String(err?.message || err);
        setMatchState(s => ({ ...s, [bug.id]: { error: msg } }));
        if (auto) setMatchPaused(msg);
      })
      .finally(() => {
        if (auto) matchBusy.current = false;
        if (mountedRef.current) setMatchTick(t => t + 1);
      });
  };

  useEffect(() => {
    if (!rx95Ready || matchPaused || matchBusy.current || matchCount.current >= MAX_AUTO_MATCHES) return;
    const attempted = (b: BugLog) => matchAttempted.current.has(`${b.id}|${bugTextSig(b)}`);
    // Single Repro'd bugs: the background worker checks them; the in-tab engine is only the fallback.
    const next = workerFresh ? undefined : visible.find(b => isReproRow(b) && !matchesFor(b) && !attempted(b));
    if (next) { runMatch(next, true); return; }
    // Bundles with a Repro'd member are checked here (the worker checks single reports only).
    const g = shownGroups.find(x => isReproGroup(x) && !groupMatches(x) && !attempted(bundleQueryBug(x)));
    if (g) runMatch(bundleQueryBug(g), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, shownGroups, rx95Ready, matchTick, matchPaused, workerFresh]);

  const retryMatches = () => {
    matchAttempted.current.clear();
    matchCount.current = 0;
    setMatchPaused(undefined);
    setMatchTick(t => t + 1);
  };

  const patchBug = (bugId: string, patch: Partial<BugLog>) => onPatchBugLog?.(bugId, patch);

  const commentFor = (bug: BugLog) => buildFollowUpComment(bug, { planName: planName(bug.planId), refined: refinedFor(bug) });

  const copyText = (text: string): Promise<boolean> => {
    try {
      return navigator.clipboard ? navigator.clipboard.writeText(text).then(() => true, () => false) : Promise.resolve(false);
    } catch { return Promise.resolve(false); }
  };

  /** Opens b/ID with the comment pre-filled, copies it too, then stamps the QA bug FILED (follow-up). */
  const followUp = (bug: BugLog, cand: ReproCandidate) => {
    const comment = commentFor(bug);
    // Start the clipboard write while this page still has focus, then open the tab in the same click.
    const copied = copyText(comment);
    const { url, truncated } = followUpUrl(cand.id, comment);
    const win = window.open(url, '_blank');
    if (win) { try { win.opener = null; } catch { /* cross-origin - fine */ } }
    copied.then(ok => {
      if (!win) {
        flash(`Your browser blocked the pop-up. ${ok ? 'The comment is copied - ' : ''}allow pop-ups for this site and try again. Nothing was stamped.`);
        return;
      }
      // Filed only when Buganizer confirms it: the RX95 worker looks for the posted comment (it carries the QA Manager ID).
      patchBug(bug.id, { filePending: pendingFor('follow-up', { issueId: cand.id, hotlistId: matchesFor(bug)?.hotlistId }) });
      flash(`Opened b/${cand.id} with the comment pre-filled${truncated ? ' (shortened)' : ''}${ok ? ' and copied it' : ''}. Review it and click Post - RX95 stamps it FILED once your comment shows up.`);
    });
  };

  const patchMany = (patches: Record<string, Partial<BugLog>>) => {
    if (onPatchBugLogs) onPatchBugLogs(patches);
    else Object.entries(patches).forEach(([id, patch]) => onPatchBugLog?.(id, patch));
  };
  const forMembers = (members: BugLog[], patch: (m: BugLog) => Partial<BugLog>) =>
    patchMany(Object.fromEntries(members.map(m => [m.id, patch(m)])));

  /** Follow up on an existing issue for a whole bundle (comment lists every report). */
  const followUpBundle = (g: BundleGroup, cand: ReproCandidate) => {
    const comment = buildBundleFollowUpComment(g, { planName: planName(g.members[0]?.planId), refinedFor });
    const copied = copyText(comment);
    const { url, truncated } = followUpUrl(cand.id, comment);
    const win = window.open(url, '_blank');
    if (win) { try { win.opener = null; } catch { /* cross-origin - fine */ } }
    copied.then(ok => {
      if (!win) {
        flash(`Your browser blocked the pop-up. ${ok ? 'The comment is copied - ' : ''}allow pop-ups for this site and try again. Nothing was changed.`);
        return;
      }
      const hotlistId = groupMatches(g)?.hotlistId;
      forMembers(g.members, () => ({ filePending: pendingFor('follow-up', { issueId: cand.id, hotlistId, bundleId: g.bundle.id }) }));
      flash(`Opened b/${cand.id} with the bundle's comment${truncated ? ' (shortened)' : ''}${ok ? ' (also copied)' : ''}. Review it and click Post - all ${g.members.length} reports get stamped FILED once it shows up.`);
    });
  };

  // ---------- same-day bundles ----------
  const createBundle = (members: BugLog[], title: string, summary: string | undefined, by: 'rx95' | 'manual') => {
    const ok = members.filter(isBundleable);
    if (ok.length < 2) return flash('Pick at least two unfiled reports to bundle.');
    const bd = newBundle(ok.map(m => m.id), title, summary, by);
    forMembers(ok, () => ({ bundle: bd }));
    setSelected(new Set());
    flash(`Bundled ${ok.length} reports into one bug.`);
  };
  const unbundle = (g: BundleGroup) => {
    forMembers(g.members, () => ({ bundle: undefined }));
    setEditingBundle(null);
    flash(`Unbundled ${g.members.length} reports.`);
  };
  const saveBundleEdit = (g: BundleGroup, keep: Set<string>) => {
    const kept = g.members.filter(m => keep.has(m.id));
    if (kept.length < 2) return unbundle(g);
    const bd = { ...g.bundle, memberIds: kept.map(m => m.id), at: new Date().toISOString() };
    patchMany(Object.fromEntries(g.members.map(m => [m.id, keep.has(m.id) ? { bundle: bd } : { bundle: undefined }])));
    setEditingBundle(null);
  };
  const dismissSuggestion = (id: string) => setDismissed(prev => { const n = new Set(prev); n.add(id); saveDismissed(n); return n; });
  const shown = useMemo(
    () => shownSuggestions(rx95Suggestions?.sets || [], bugs, dismissed).filter(x => (planId === 'all' || x.set.planId === planId) && (!day || x.set.day === day)),
    [rx95Suggestions, bugs, dismissed, planId, day],
  );

  // Repro'd bugs (match panel) are never opened as new issues in bulk.
  const selectedVisible = visible.filter(b => selected.has(b.id) && !isReproRow(b));
  const selectedGroups = shownGroups.filter(g => selected.has(g.bundle.id) && !isReproGroup(g));
  const selectedCount = selectedVisible.length + selectedGroups.length;
  const selectedBundleable = visible.filter(b => selected.has(b.id) && isBundleable(b));
  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4000); };

  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAllReady = () => setSelected(new Set([
    ...visible.filter(b => draftFor(b).state === 'ready').map(b => b.id),
    ...shownGroups.filter(g => megaDraftFor(g).state === 'ready').map(g => g.bundle.id),
  ]));
  const markSelected = (state: DraftState) => {
    selectedVisible.forEach(b => updateDraft(b, { state }));
    selectedGroups.forEach(g => updateMega(g, { state }));
    flash(`${selectedCount} bug${selectedCount === 1 ? '' : 's'} marked ${STATE_LABEL[state]}.`);
  };

  const startOpen = () => {
    const list = [...selectedVisible.map(draftFor), ...selectedGroups.map(megaDraftFor)];
    if (list.length === 0) return flash('Select at least one bug first.');
    setAllowOpen(false);
    setPreviewExpanded(new Set());
    setPreview(list);
  };

  /**
   * Opens one prefilled form per draft. Browsers allow only ONE pop-up per click unless pop-ups are
   * allowed for this site, so anything the browser blocks is kept in a "blocked" list the user can
   * retry after allowing pop-ups (or open one per click). Never use 'noopener' here: it makes
   * window.open return null even on success, which hides whether a tab was blocked.
   */
  const tryOpen = (d: BuganizerDraft): boolean => {
    const win = window.open(buildBuganizerUrl(d), '_blank');
    if (!win) return false;
    try { win.opener = null; } catch { /* cross-origin - fine */ }
    return true;
  };

  const markOpened = (ds: BuganizerDraft[]) => {
    if (ds.length === 0) return;
    const ids = new Set(ds.map(d => d.bugId));
    setDrafts(prev => {
      const next = { ...prev };
      bugs.filter(b => ids.has(b.id)).forEach(b => {
        next[b.id] = { ...(prev[b.id] || draftFor(b)), state: 'opened', updatedAt: Date.now() };
      });
      groups.forEach(g => {
        if (ids.has(g.bundle.id)) next[g.bundle.id] = { ...megaDraftFrom(prev, g), state: 'opened', updatedAt: Date.now() };
      });
      return next;
    });
    // Not FILED yet: the RX95 worker confirms it by finding a new bug in the hotlist that carries the QA Manager ID(s).
    const patches: Record<string, Partial<BugLog>> = {};
    ds.forEach(d => {
      const hotlistId = d.hotlistIds[0];
      const g = groups.get(d.bugId);
      if (g) g.members.forEach(m => { patches[m.id] = { filePending: pendingFor('bundle', { hotlistId, bundleId: g.bundle.id }) }; });
      else patches[d.bugId] = { filePending: pendingFor('new', { hotlistId }) };
    });
    patchMany(patches);
  };

  const openTabs = (list: BuganizerDraft[]) => {
    const opened: BuganizerDraft[] = [];
    const blocked: BuganizerDraft[] = [];
    list.forEach(d => (tryOpen(d) ? opened : blocked).push(d));
    markOpened(opened);
    setPreview(null);
    setOpenQueue(blocked);
    if (blocked.length) {
      flash(`Opened ${opened.length} of ${list.length}. Your browser blocked ${blocked.length} - allow pop-ups for this site, then click "Open remaining".`);
    } else {
      flash(`Opened ${opened.length} prefilled Buganizer form${opened.length === 1 ? '' : 's'}. Review each and click Create there.`);
    }
  };

  /** Retries every blocked tab (all open if pop-ups are now allowed; otherwise at least the next one). */
  const openRemaining = () => {
    const opened: BuganizerDraft[] = [];
    const blocked: BuganizerDraft[] = [];
    openQueue.forEach(d => (tryOpen(d) ? opened : blocked).push(d));
    markOpened(opened);
    setOpenQueue(blocked);
    flash(blocked.length
      ? `Opened ${opened.length} more. ${blocked.length} still blocked - allow pop-ups for this site to open them all at once.`
      : `Opened the remaining ${opened.length} form${opened.length === 1 ? '' : 's'}.`);
  };

  const copyLinks = async (list: BuganizerDraft[]) => {
    const text = list.map(d => `${d.title}\n${buildBuganizerUrl(d)}`).join('\n\n');
    try { await navigator.clipboard.writeText(text); flash('Links copied.'); } catch { flash('Copy blocked by the browser.'); }
  };

  interface DraftTarget {
    /** Bug id, or bundle id for a mega bug. */
    key: string;
    d: BuganizerDraft;
    update: (patch: Partial<BuganizerDraft>) => void;
    planId?: string;
    top?: React.ReactNode;
    bottom?: React.ReactNode;
    /** "Filed as b/" committed (blur/Enter); undefined when cleared. */
    onFiledAs: (issueId: string | undefined) => void;
  }

  /** New-issue draft fields (a single bug or a bundle's mega bug). */
  const renderDraftFields = (t: DraftTarget) => {
    const d = t.d;
    const url = buildBuganizerUrl(d);
    const comp = componentById(d.componentId);
    const isOpen = expanded === t.key;
    return (
                  <div className="space-y-2" data-testid="draft-fields">
                    {t.top}
                    <div>
                      <label className={labelCls}>Title</label>
                      <input aria-label="Title" className={inputCls} value={d.title} onChange={e => t.update({ title: e.target.value })} />
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <div className="col-span-2">
                        <label className={labelCls}>Component</label>
                        <select aria-label="Component" className={inputCls} value={d.componentId} onChange={e => t.update({ componentId: e.target.value })}>
                          <optgroup label="Most used by your team">
                            {topComponents.map(c => <option key={c.id} value={c.id}>{c.name}{pathTail(c.path) ? ` (${pathTail(c.path)})` : ''} · {c.uses}</option>)}
                          </optgroup>
                          <optgroup label="All other components">
                            {otherComponents.map(c => <option key={c.id} value={c.id}>{c.name}{pathTail(c.path) ? ` (${pathTail(c.path)})` : ''}</option>)}
                          </optgroup>
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Priority</label>
                        <select aria-label="Priority" className={inputCls} value={d.priority} onChange={e => t.update({ priority: e.target.value })}>
                          {BUGANIZER_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Type</label>
                        <select aria-label="Type" className={inputCls} value={d.type} onChange={e => t.update({ type: e.target.value })}>
                          {BUGANIZER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </div>
                    </div>
                    {comp && <p className="text-[10px] text-slate-500 truncate" title={comp.path}>{comp.path} · <a className="text-blue-400 hover:underline" href={`https://b.corp.google.com/components/${comp.id}`} target="_blank" rel="noreferrer">{comp.id}</a></p>}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <div className="col-span-2">
                        <label className={labelCls}>Hotlist</label>
                        {(() => {
                          const cur = d.hotlistIds.join(', ');
                          const known = KNOWN_HOTLISTS.some(h => h.hotlistId === cur);
                          return (
                            <select aria-label="Hotlist" className={inputCls} value={cur}
                              title={hotlistForPlan(t.planId, planName(t.planId)) ? `Auto-set from test plan: ${hotlistForPlan(t.planId, planName(t.planId))!.name}` : 'No hotlist mapped to this test plan'}
                              onChange={e => t.update({ hotlistIds: e.target.value ? [e.target.value] : [] })}>
                              <option value="">None</option>
                              {KNOWN_HOTLISTS.map(h => <option key={h.hotlistId} value={h.hotlistId}>{h.name} · {h.hotlistId}</option>)}
                              {cur && !known && <option value={cur}>Custom · {cur}</option>}
                            </select>
                          );
                        })()}
                      </div>
                      <div>
                        <label className={labelCls}>Assignee</label>
                        <input aria-label="Assignee" className={inputCls} value={d.assignee} placeholder="ldap" onChange={e => t.update({ assignee: e.target.value })} />
                      </div>
                      <div>
                        <label className={labelCls}>CC</label>
                        <input aria-label="CC" className={inputCls} value={d.cc} placeholder="ldap1, team@google.com" onChange={e => t.update({ cc: e.target.value })} />
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>Found in</label>
                      <input aria-label="Found in" className={inputCls} value={d.foundIn || ''} placeholder="Glasses firmware build (scanned in QA Tester)"
                        onChange={e => t.update({ foundIn: e.target.value })} />
                    </div>
                    {isOpen && (
                      <div>
                        <label className={labelCls}>Description (Markdown)</label>
                        <textarea aria-label="Description" rows={9} className={`${inputCls} font-mono leading-relaxed`} value={d.description} onChange={e => t.update({ description: e.target.value })} />
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button className="px-2.5 h-7 rounded-xl text-xs text-slate-300 hover:bg-slate-800" onClick={() => setExpanded(isOpen ? null : t.key)}>
                        {isOpen ? 'Hide description' : 'Edit description'}
                      </button>
                      {d.state === 'draft' && (
                        <button className="px-2.5 h-7 rounded-xl text-xs font-semibold bg-blue-600/20 text-blue-200 border border-blue-500/40" onClick={() => t.update({ state: 'ready' })}>
                          <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" />Ready to file
                        </button>
                      )}
                      {d.state !== 'draft' && d.state !== 'filed' && (
                        <button className="px-2.5 h-7 rounded-xl text-xs text-slate-300 hover:bg-slate-800" onClick={() => t.update({ state: 'draft' })}>Back to draft</button>
                      )}
                      <button className="px-2.5 h-7 rounded-xl text-xs text-slate-300 hover:bg-slate-800" onClick={() => { setAllowOpen(false); setPreviewExpanded(new Set([d.bugId])); setPreview([d]); }}>
                        <Eye className="w-3.5 h-3.5 inline mr-1" />Preview
                      </button>
                      <div className="flex items-center gap-1 ml-auto">
                        <span className="text-[11px] text-slate-400">Filed as b/</span>
                        <input aria-label="Filed issue id" className="w-28 bg-[#0f172a] border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100" value={d.issueId || ''} placeholder="573…"
                          onChange={e => { const id = e.target.value.replace(/[^\d]/g, ''); t.update({ issueId: id || undefined, state: id ? 'filed' : (d.state === 'filed' ? 'opened' : d.state) }); }}
                          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          // Stamp FILED once the number is entered (not on every keystroke - it would vanish mid-typing)
                          onBlur={() => t.onFiledAs(d.issueId)} />
                      </div>
                    </div>
                    {t.bottom}
                    {url.length > MAX_SAFE_URL_LENGTH && (
                      <p className="text-[11px] text-amber-300">This link is very long ({url.length} chars). Shorten the description so the form opens reliably.</p>
                    )}
                  </div>
    );
  };

  interface ReproTarget {
    /** Bug id, or bundle id */
    key: string;
    /** The bug, or a bundle's synthetic query, sent to the matcher */
    query: BugLog;
    matches?: ReproMatches;
    comment: () => string;
    onFollowUp: (cand: ReproCandidate) => void;
    onFileNew: () => void;
  }

  const renderReproPanel = (t: ReproTarget) => {
    const m = t.matches;
    const st = matchState[t.key] || {};
    const pickedId = picked[t.key];
    const cand = m?.candidates.find(c => c.id === pickedId);
    const comment = cand ? t.comment() : '';
    const showComment = commentOpen.has(t.key);
    return (
      <div className="space-y-2" data-testid="repro-panel">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={labelCls + ' mb-0'}>Possible existing bugs (pick one to follow up)</p>
          <span className="text-[11px] text-slate-400" data-testid="repro-checked">
            {st.running ? 'Checking…' : m ? `checked ${minutesAgo(m.at)}` : st.error ? 'Check failed' : rx95Ready ? 'Not checked yet' : ''}
            {rx95Ready && !st.running && (
              <> · <button data-testid="repro-recheck" className="text-blue-300 hover:underline" onClick={() => runMatch(t.query, false)}>{m ? 're-check' : 'check now'}</button></>
            )}
          </span>
        </div>
        {!rx95Ready && <p className="text-xs text-slate-400">RX95 isn't available here (needs the cloud connection), so possible existing bugs can't be looked up.</p>}
        {st.error && <p className="text-xs text-amber-300" data-testid="repro-error">{st.error}</p>}
        {m && m.candidates.length === 0 && (
          <p className="text-xs text-slate-400" data-testid="repro-none">RX95 found no likely existing bug ({m.searched} searched in hotlist {m.hotlistId}).</p>
        )}
        {m && m.candidates.map(c => {
          const sel = c.id === pickedId;
          return (
            <label key={c.id} data-testid="repro-candidate"
              className={`flex gap-2.5 items-start rounded-2xl border px-3 py-2.5 cursor-pointer ${sel ? 'border-violet-500 ring-1 ring-violet-500/50 bg-violet-500/[0.07]' : 'border-slate-700 bg-[#0b1220]'} ${c.verdict === 'unlikely' && !sel ? 'opacity-75' : ''}`}>
              <input type="radio" name={`repro-${t.key}`} className="mt-1 accent-violet-400" checked={sel} onChange={() => setPicked(prev => ({ ...prev, [t.key]: c.id }))} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <a href={issueUrl(c.id)} target="_blank" rel="noreferrer" className="font-extrabold text-blue-300 hover:underline text-xs" onClick={e => e.stopPropagation()}>b/{c.id}</a>
                  <span data-testid="repro-verdict" className={`text-[11px] font-extrabold rounded-full px-2 py-0.5 border ${VERDICT_STYLE[c.verdict]}`}>{VERDICT_LABEL[c.verdict]} · {Math.round(c.confidence)}%</span>
                  {(c.status || c.priority) && <span className="text-[11px] rounded-full px-2 py-0.5 border border-slate-700 bg-slate-800 text-slate-300">{[c.status, c.priority].filter(Boolean).join(' · ')}</span>}
                </div>
                <p className="text-[12.5px] text-slate-100 mt-0.5 leading-snug">{c.title}</p>
                {c.reason && <p className="text-[11px] text-slate-400 mt-1">Why: {c.reason}</p>}
              </div>
            </label>
          );
        })}
        {cand && showComment && (
          <pre data-testid="followup-comment" className="whitespace-pre-wrap bg-[#0b1220] border border-slate-700 rounded-xl p-3 text-[11px] leading-relaxed text-slate-200 font-mono max-h-64 overflow-auto">{comment}</pre>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button data-testid="repro-follow-up" disabled={!cand} onClick={() => cand && t.onFollowUp(cand)}
            className="px-3 h-8 rounded-xl text-xs font-bold flex items-center gap-1.5 bg-violet-500/20 border border-violet-500/50 text-violet-100 hover:bg-violet-500/30 disabled:opacity-40 disabled:cursor-not-allowed">
            <ExternalLink className="w-3.5 h-3.5" /> {cand ? `Follow up on b/${cand.id}` : 'Follow up'}
          </button>
          {cand && (
            <>
              <button data-testid="repro-comment-toggle" className="px-2.5 h-8 rounded-xl text-xs text-slate-300 hover:bg-slate-800"
                onClick={() => setCommentOpen(prev => { const n = new Set(prev); n.has(t.key) ? n.delete(t.key) : n.add(t.key); return n; })}>
                <Eye className="w-3.5 h-3.5 inline mr-1" />{showComment ? 'Hide comment' : 'Preview comment'}
              </button>
              <button data-testid="repro-copy-comment" className="px-2.5 h-8 rounded-xl text-xs text-slate-300 hover:bg-slate-800"
                onClick={() => copyText(comment).then(ok => flash(ok ? 'Comment copied.' : 'Copy blocked by the browser.'))}>
                <Copy className="w-3.5 h-3.5 inline mr-1" />Copy comment
              </button>
            </>
          )}
          <button data-testid="repro-file-new" className="px-3 h-8 rounded-xl text-xs font-semibold border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
            onClick={() => t.onFileNew()}>
            None of these: file as new bug
          </button>
          <span className="text-[11px] text-slate-500 ml-auto">Nothing is posted automatically.</span>
        </div>
      </div>
    );
  };


  /** Same-day bundle suggestion cards (RX95 worker output), grouped by plan-day. */
  const renderSuggestions = () => {
    if (shown.length === 0) return null;
    const bySet = new Map<string, typeof shown>();
    shown.forEach(x => { const k = x.set.id || `${x.set.planId}|${x.set.day}`; bySet.set(k, [...(bySet.get(k) || []), x]); });
    return Array.from(bySet.entries()).map(([k, items]) => {
      const set = items[0].set;
      const unfiled = bugs.filter(b => b.planId === set.planId && localDay(b.timestamp) === set.day && isBundleable(b)).length;
      const reports = items.reduce((n, x) => n + x.members.length, 0);
      return (
        <div key={k} className="space-y-3" data-testid="bundle-suggestions">
          <div className="rounded-[20px] border border-violet-500/35 bg-violet-500/10 px-4 py-2.5 flex flex-wrap items-center gap-3 text-xs text-violet-100">
            <span>✨</span>
            <div className="flex-1 min-w-[240px]">
              <b>RX95 same-day check.</b> {planName(set.planId)} · <b>{fmtDay(set.day)}</b>: {unfiled} unfiled report{unfiled === 1 ? '' : 's'} → <b>{items.length} suggested bundle{items.length === 1 ? '' : 's'}</b> ({reports} reports).
            </div>
            {set.at && <span className="text-slate-400">checked {minutesAgo(set.at)}</span>}
          </div>
          {items.map(({ suggestion: sg, members, maybe }) => {
            const ticked = new Set(ticks[sg.id] ?? members.filter(m => !maybe.has(m.id)).map(m => m.id));
            const tickedMembers = members.filter(m => ticked.has(m.id));
            const testersN = new Set(members.map(m => (m.testerName || '').trim()).filter(Boolean)).size;
            const devicesN = new Set(members.map(m => (m.deviceName || '').trim()).filter(Boolean)).size;
            const setTick = (id: string, on: boolean) => setTicks(prev => {
              const cur = new Set(prev[sg.id] ?? members.filter(m => !maybe.has(m.id)).map(m => m.id));
              if (on) cur.add(id); else cur.delete(id);
              return { ...prev, [sg.id]: Array.from(cur) };
            });
            return (
              <div key={sg.id} data-testid="bundle-suggestion" className="rounded-[20px] border border-slate-800 bg-[#111827] p-4">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="px-2 py-0.5 rounded-full border border-violet-500/50 bg-violet-500/15 text-violet-200">🧩 Suggested bundle</span>
                  <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">{bundleCuj(members)}</span>
                  <span className={`font-extrabold rounded-full px-2 py-0.5 border ${sg.confidence >= 80 ? VERDICT_STYLE.very_likely : VERDICT_STYLE.possible}`}>Same issue · {Math.round(sg.confidence)}%</span>
                  <span className="text-slate-400">{members.length} reports · {testersN} tester{testersN === 1 ? '' : 's'} · {devicesN} device{devicesN === 1 ? '' : 's'}</span>
                </div>
                <p className="text-[15px] font-extrabold text-white mt-2">{sg.title}</p>
                {sg.reason && <p className="text-xs text-slate-400 mt-0.5">Why: {sg.reason}</p>}
                <div className="mt-1.5 space-y-1.5">
                  {members.map(m => {
                    const on = ticked.has(m.id);
                    const unsure = maybe.has(m.id);
                    return (
                      <label key={m.id} data-testid="suggestion-member" className={`flex gap-2.5 items-start rounded-xl border border-slate-700 bg-[#0b1220] px-3 py-2 cursor-pointer ${on ? '' : 'opacity-50'}`}>
                        <input type="checkbox" className="mt-0.5 accent-violet-400" checked={on} onChange={e => setTick(m.id, e.target.checked)} />
                        <span className="font-mono text-[11.5px] text-violet-300 w-[70px] flex-none">{fmtTime(m.timestamp)}</span>
                        <span className="min-w-0 flex-1">
                          <b className="text-[12.5px] text-slate-100">{m.title || titleFromNote(m.note)}</b>
                          {unsure && <span className={`ml-2 text-[11px] font-extrabold rounded-full px-2 py-0.5 border ${VERDICT_STYLE.possible}`}>Unsure</span>}
                          <span className="block text-[11px] text-slate-400">
                            {[m.testerName || 'Unknown', m.deviceName || '?', m.environment?.glassesFirmware].filter(Boolean).join(' · ')}
                            {m.title && (m.note || '').trim() && m.note.trim() !== m.title.trim() ? ` · "${m.note.trim().slice(0, 120)}"` : ''}{unsure ? ' · left out by default' : ''}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <button data-testid="suggestion-bundle" disabled={tickedMembers.length < 2}
                    onClick={() => createBundle(tickedMembers, sg.title, sg.summary, 'rx95')}
                    className="px-3 h-8 rounded-xl text-xs font-bold bg-violet-500/20 border border-violet-500/55 text-violet-50 hover:bg-violet-500/30 disabled:opacity-40 disabled:cursor-not-allowed">
                    🧩 Bundle {tickedMembers.length} reports into one bug
                  </button>
                  <button data-testid="suggestion-dismiss" className="px-3 h-8 rounded-xl text-xs font-semibold border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700" onClick={() => dismissSuggestion(sg.id)}>
                    Not the same issue
                  </button>
                  <span className="text-[11px] text-slate-500 ml-auto">Untick any report to leave it out · nothing is filed until you open it in Buganizer</span>
                </div>
              </div>
            );
          })}
        </div>
      );
    });
  };

  /** One entry of the "Waiting for Buganizer" group (a single bug or a whole bundle). */
  const renderWaiting = (e: { key: string; pending: BugFilePending; members: BugLog[]; group?: BundleGroup }) => {
    const p = e.pending;
    const first = e.members[0];
    const n = e.group ? e.group.members.length : 1;
    const title = e.group ? `${e.group.bundle.title} (reported ${n}×)` : (first.title || titleFromNote(first.note));
    const kindLabel = p.kind === 'follow-up' ? `Follow-up · b/${p.issueId || '?'}` : p.kind === 'bundle' ? `Bundle · ${n} reports${p.issueId ? ` · b/${p.issueId}` : ''}` : `New bug${p.issueId ? ` · b/${p.issueId}` : ''}`;
    const via = p.kind === 'follow-up' ? 'follow-up' : p.kind === 'bundle' ? 'bundle' : 'new';
    const members = e.group ? e.group.members : e.members;
    const typedId = waitingIssue[e.key] || '';
    const reopen = () => {
      let url = '';
      if (p.kind === 'follow-up' && p.issueId) {
        const comment = e.group ? buildBundleFollowUpComment(e.group, { planName: planName(first.planId), refinedFor }) : commentFor(first);
        copyText(comment);
        url = followUpUrl(p.issueId, comment).url;
      } else {
        url = buildBuganizerUrl(e.group ? megaDraftFor(e.group) : draftFor(first));
      }
      const win = window.open(url, '_blank');
      if (!win) return flash('Your browser blocked the pop-up - allow pop-ups for this site and try again.');
      try { win.opener = null; } catch { /* fine */ }
      // An expired wait starts over (the worker only looks at issues created after openedAt)
      if (p.expired) forMembers(members, () => ({ filePending: { ...p, expired: undefined, openedAt: new Date().toISOString() } }));
    };
    return (
      <div key={e.key} data-testid="waiting-item" className="rounded-2xl border border-slate-800 bg-[#111827] p-3">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {p.expired ? (
            <span data-testid="waiting-expired" className="px-2 py-0.5 rounded-full border border-rose-500/50 bg-rose-500/12 text-rose-200">⚠ Not found in Buganizer</span>
          ) : (
            <span className="px-2 py-0.5 rounded-full border border-amber-500/50 bg-amber-500/12 text-amber-200">⏳ Waiting for Buganizer</span>
          )}
          <span className="px-2 py-0.5 rounded-full border border-slate-700 bg-slate-800 text-slate-300">{kindLabel}</span>
        </div>
        <p className="text-sm font-extrabold text-white mt-1.5">{title}</p>
        <p className="text-xs text-slate-400 mt-0.5">
          {p.expired
            ? `RX95 didn't find it in Buganizer within 24 hours of opening it (${fmtTime(p.openedAt)}). Reopen it, or mark it filed if you did file it.`
            : p.kind === 'follow-up'
            ? `Opened b/${p.issueId} with the comment at ${fmtTime(p.openedAt)}. RX95 checks Buganizer every minute for your posted comment (it carries ${n > 1 ? "these reports'" : "this report's"} QA Manager ID).`
            : `Opened the prefilled new-bug form at ${fmtTime(p.openedAt)}. RX95 looks for a new bug${p.hotlistId ? ` in hotlist ${p.hotlistId}` : ''} that carries ${n > 1 ? "these reports'" : "this report's"} QA Manager ID.`}
        </p>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <button data-testid="waiting-reopen" className="px-2.5 h-7 rounded-xl text-xs font-semibold border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700" onClick={reopen}>
            <ExternalLink className="w-3.5 h-3.5 inline mr-1" />Reopen{p.issueId ? ` b/${p.issueId}` : ''}
          </button>
          {!p.issueId && (
            <input data-testid="waiting-issue" aria-label="Filed b/ issue number" className="w-36 bg-[#0f172a] border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100 font-mono"
              placeholder="b/ number (optional)" value={typedId}
              onChange={ev => setWaitingIssue(prev => ({ ...prev, [e.key]: ev.target.value.replace(/[^\d]/g, '').slice(0, 12) }))} />
          )}
          <button data-testid="waiting-mark-filed" className="px-2.5 h-7 rounded-xl text-xs font-semibold border border-green-500/40 bg-green-500/10 text-green-200 hover:bg-green-500/20"
            onClick={() => forMembers(members, () => ({ filed: newFiled(via, p.issueId || typedId), filePending: undefined }))}>
            Mark filed anyway
          </button>
          <button data-testid="waiting-cancel" className="px-2.5 h-7 rounded-xl text-xs text-slate-300 hover:bg-slate-800"
            onClick={() => forMembers(members, () => ({ filePending: undefined }))}>
            Cancel
          </button>
        </div>
      </div>
    );
  };

  /** The bundle's "mega bug" row (replaces its members in the list). */
  const renderBundleRow = (g: BundleGroup) => {
    const d = megaDraftFor(g);
    const n = g.members.length;
    const filedAll = groupIsFiled(g);
    const reprodMember = groupHasReprod(g);
    const showRepro = isReproGroup(g);
    const editing = editingBundle?.id === g.bundle.id ? editingBundle : null;
    const firstPlan = g.members[0]?.planId;
    return (
      <div key={g.bundle.id} data-testid="bundle-row" className={`rounded-[20px] border bg-[#111827] p-4 ring-1 ${selected.has(g.bundle.id) ? 'border-blue-500/60 ring-blue-500/30' : 'border-violet-500/50 ring-violet-500/25'}`}>
        <div className="flex items-start gap-3">
          <input type="checkbox" aria-label={`Select bundle ${g.bundle.id}`} className="mt-1 accent-blue-500" checked={selected.has(g.bundle.id)} onChange={() => toggle(g.bundle.id)} />
          <div className="flex-1 min-w-0 grid grid-cols-1 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.5fr)] gap-4">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span data-testid="bundle-pill" className="px-2 py-0.5 rounded-full border border-violet-500/50 bg-violet-500/15 text-violet-200">🧩 Bundle · {n} reports</span>
                {filedAll && <span className="px-2 py-0.5 rounded-full border bg-green-500/15 text-green-300 border-green-500/40 font-bold">FILED{filedStampLine(effectiveFiled(g.members[0])!) ? ` · ${filedStampLine(effectiveFiled(g.members[0])!)}` : ''}</span>}
                {reprodMember && <span className="px-2 py-0.5 rounded-full border border-violet-500/50 bg-violet-500/15 text-violet-200 flex items-center gap-1"><Repeat className="w-3 h-3" /> Repro'd Issue</span>}
                {!showRepro && <span className={`px-2 py-0.5 rounded-full border ${STATE_STYLE[d.state]}`}>{STATE_LABEL[d.state]}</span>}
                <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">{bundleCuj(g.members)}</span>
              </div>
              <p className="text-sm font-extrabold text-white leading-snug" data-testid="bundle-title">{g.bundle.title}</p>
              <p className="text-[11px] text-slate-500">{g.bundle.by === 'rx95' ? "Bundled from RX95's suggestion" : 'Bundled by hand'} · {planName(firstPlan)}</p>
              {editing ? (
                <div className="space-y-1" data-testid="bundle-edit-list">
                  {g.members.map(m => (
                    <label key={m.id} className="flex items-center gap-2 text-[11.5px] text-slate-200">
                      <input type="checkbox" data-testid="bundle-edit-member" className="accent-violet-400" checked={editing.keep.has(m.id)}
                        onChange={ev => setEditingBundle(prev => { if (!prev) return prev; const k = new Set(prev.keep); ev.target.checked ? k.add(m.id) : k.delete(m.id); return { ...prev, keep: k }; })} />
                      <span className="font-mono text-violet-300">{fmtTime(m.timestamp)}</span>
                      <span className="truncate">{m.testerName || 'Unknown'} · {m.title || titleFromNote(m.note)}</span>
                    </label>
                  ))}
                  <div className="flex gap-2 pt-1">
                    <button data-testid="bundle-edit-save" className="px-2.5 h-7 rounded-xl text-xs font-semibold bg-violet-500/20 border border-violet-500/50 text-violet-100" onClick={() => saveBundleEdit(g, editing.keep)}>
                      Save ({editing.keep.size} report{editing.keep.size === 1 ? '' : 's'})
                    </button>
                    <button className="px-2.5 h-7 rounded-xl text-xs text-slate-300 hover:bg-slate-800" onClick={() => setEditingBundle(null)}>Cancel</button>
                  </div>
                  {editing.keep.size < 2 && <p className="text-[11px] text-amber-300">Fewer than 2 reports: saving unbundles them.</p>}
                </div>
              ) : (
                <table className="w-full text-[11.5px] mt-1" data-testid="bundle-members">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-slate-400 text-left">
                      <th className="py-1 pr-2 font-bold">Time</th><th className="py-1 pr-2 font-bold">Tester</th><th className="py-1 pr-2 font-bold">Device</th><th className="py-1 font-bold">Firmware</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.members.map(m => (
                      <tr key={m.id} className="border-t border-slate-800 text-slate-200" title={memberReportText(m)}>
                        <td className="py-1 pr-2 whitespace-nowrap">{fmtTime(m.timestamp)}</td>
                        <td className="py-1 pr-2">{m.testerName || 'Unknown'}</td>
                        <td className="py-1 pr-2">{m.deviceName || '?'}</td>
                        <td className="py-1 font-mono text-[10.5px]">{m.environment?.glassesFirmware ? `…${m.environment.glassesFirmware.slice(-11)}` : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!editing && (
                <div className="flex gap-2 pt-1.5">
                  <button data-testid="bundle-edit" className="px-2.5 h-7 rounded-xl text-xs font-semibold border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                    onClick={() => setEditingBundle({ id: g.bundle.id, keep: new Set(g.members.map(m => m.id)) })}>Edit reports</button>
                  <button data-testid="bundle-unbundle" className="px-2.5 h-7 rounded-xl text-xs font-semibold border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700" onClick={() => unbundle(g)}>Unbundle</button>
                </div>
              )}
            </div>
            {showRepro ? renderReproPanel({
              key: g.bundle.id,
              query: bundleQueryBug(g),
              matches: groupMatches(g),
              comment: () => buildBundleFollowUpComment(g, { planName: planName(firstPlan), refinedFor }),
              onFollowUp: cand => followUpBundle(g, cand),
              onFileNew: () => updateMega(g, { fileAsNew: true, reproCheck: false }),
            }) : renderDraftFields({
              key: g.bundle.id,
              d,
              update: patch => updateMega(g, patch),
              planId: firstPlan,
              top: (reprodMember || d.reproCheck) && d.fileAsNew ? (
                <button data-testid="repro-back-to-matches" className="px-2 py-0.5 rounded-full border border-violet-500/40 text-[11px] text-violet-200 hover:bg-violet-500/10" onClick={() => updateMega(g, { fileAsNew: false })}>
                  ← Back to RX95's possible existing bugs
                </button>
              ) : undefined,
              bottom: (
                <div className="flex flex-wrap items-center gap-2">
                  <button data-testid="bundle-open" className="px-3 h-8 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white"
                    onClick={() => { setAllowOpen(false); setPreviewExpanded(new Set([d.bugId])); setPreview([d]); }}>
                    <ExternalLink className="w-3.5 h-3.5" /> Open in Buganizer
                  </button>
                  <button data-testid="bundle-check-hotlist" disabled={!rx95Ready} className="px-3 h-8 rounded-xl text-xs font-semibold border border-violet-500/45 bg-violet-500/15 text-violet-100 hover:bg-violet-500/25 disabled:opacity-40"
                    onClick={() => { updateMega(g, { reproCheck: true, fileAsNew: false }); if (!groupMatches(g)) runMatch(bundleQueryBug(g), false); }}>
                    ✨ Check hotlist for an existing bug
                  </button>
                  <span className="text-[11px] text-slate-500 ml-auto">Filing stamps all {n} reports FILED with the same b/ number</span>
                </div>
              ),
              onFiledAs: id => {
                if (id) forMembers(g.members, () => ({ filed: newFiled('bundle', id), filePending: undefined }));
                else if (g.members.every(m => m.filed?.via === 'bundle')) forMembers(g.members, () => ({ filed: undefined }));
              },
            })}
          </div>
        </div>
      </div>
    );
  };

  /** List rows: single bugs and bundles, newest first. */
  const rows = [
    ...visible.map(b => ({ kind: 'bug' as const, ts: String(b.timestamp), bug: b })),
    ...shownGroups.map(g => ({ kind: 'bundle' as const, ts: String(g.members[g.members.length - 1]?.timestamp || ''), group: g })),
  ].sort((a, b) => b.ts.localeCompare(a.ts));

  return (
    <div className="space-y-5" data-testid="buganizer-triage">
      {/* Safety banner */}
      <div className="rounded-[20px] border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-emerald-300 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-emerald-100 leading-relaxed">
          <b>Buganizer triage.</b> Drafts are saved only in this browser. Nothing is sent to Buganizer automatically.
          "Open in Buganizer" only opens <i>prefilled forms</i>, and a bug is created only if someone reviews the form and clicks <b>Create</b>.
        </div>
      </div>

      {/* RX95 background worker (heartbeat fresh) */}
      {workerFresh && (
        <div data-testid="rx95-worker-bar" className="rounded-[20px] border border-green-500/35 bg-green-500/[0.08] px-4 py-2.5 flex flex-wrap items-center gap-2 text-xs text-green-100">
          <span>🟢</span>
          <div className="flex-1 min-w-[240px] leading-relaxed">
            <b>RX95 is working in the background.</b> New reports are cleaned up and checked as they come in.
            {' '}Last sync {Math.round(hbAgeSec)}s ago · {(heartbeat?.queues?.refine || 0) + (heartbeat?.queues?.match || 0) + (heartbeat?.queues?.bundle || 0)} in progress · {waitingCount} waiting for Buganizer.
          </div>
        </div>
      )}

      {/* RX95 wording refinement status (in-tab fallback when the background worker is offline) */}
      {!workerFresh && <div data-testid="rx95-refine-bar" className="rounded-[20px] border border-violet-500/30 bg-violet-500/10 px-4 py-2.5 flex flex-wrap items-center gap-3 text-xs text-violet-100">
        <Sparkles className="w-4 h-4 text-violet-300 flex-shrink-0" />
        <div className="flex-1 min-w-[240px] leading-relaxed">
          <b>RX95 wording cleanup.</b>{' '}
          {!rx95Ready
            ? 'Not available here (needs the cloud connection). Drafts use the reporter\'s wording.'
            : !autoRefine
            ? 'Off - drafts use the reporter\'s wording.'
            : refineState.running > 0
            ? `Refining ${refineState.running} bug${refineState.running === 1 ? '' : 's'} in the background…`
            : refineState.error
            ? `Paused: ${refineState.error}`
            : `${refinedVisible} of ${visible.length} bugs refined. RX95 rewrites the reporter's title and description; the original stays on the left.`}
        </div>
        {rx95Ready && refineState.error && autoRefine && (
          <button className="px-2.5 h-7 rounded-xl font-semibold bg-violet-500/20 border border-violet-500/40" onClick={retryRefine}>Retry</button>
        )}
        {rx95Ready && (
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" data-testid="rx95-auto-refine" className="accent-violet-400" checked={autoRefine} onChange={toggleAutoRefine} /> Auto-refine
          </label>
        )}
      </div>}

      {/* RX95 repro check + filed bugs */}
      {(reproRows.length > 0 || filedCount > 0) && (() => {
        const checked = reproRows.filter(b => matchesFor(b));
        const running = reproRows.filter(b => matchState[b.id]?.running).length;
        const hotlists = Array.from(new Set(checked.map(b => matchesFor(b)!.hotlistId)));
        const hotlistLabel = hotlists.map(id => {
          const h = KNOWN_HOTLISTS.find(k => k.hotlistId === id);
          return h ? `${h.name} · ${id}` : id;
        }).join(', ');
        const searched = checked.reduce((n, b) => Math.max(n, matchesFor(b)!.searched || 0), 0);
        return (
          <div data-testid="repro-bar" className="rounded-[20px] border border-violet-500/35 bg-violet-500/10 px-4 py-2.5 flex flex-wrap items-center gap-3 text-xs text-violet-100">
            <Repeat className="w-4 h-4 text-violet-300 flex-shrink-0" />
            <div className="flex-1 min-w-[240px] leading-relaxed">
              {reproRows.length === 0 ? (
                <span className="text-slate-300">No repro'd bugs to check.</span>
              ) : (
                <>
                  <b>RX95 repro check.</b>{' '}
                  {!rx95Ready
                    ? `${reproRows.length} repro'd bug${reproRows.length === 1 ? '' : 's'}. Not available here (needs the cloud connection).`
                    : running > 0
                    ? `Checking ${running} repro'd bug${running === 1 ? '' : 's'} against the plan's hotlist…`
                    : matchPaused
                    ? `Paused: ${matchPaused}`
                    : <>{checked.length} of {reproRows.length} repro'd bug{reproRows.length === 1 ? '' : 's'} checked{hotlistLabel ? <> against <b>{hotlistLabel}</b></> : ''}{searched ? ` (${searched} bugs searched)` : ''}.</>}
                </>
              )}
            </div>
            {rx95Ready && matchPaused && (
              <button className="px-2.5 h-7 rounded-xl font-semibold bg-violet-500/20 border border-violet-500/40" onClick={retryMatches}>Retry</button>
            )}
            {(filedCount > 0) && (
              <span className="text-slate-300 ml-auto" data-testid="filed-hidden">
                {showFiled ? `Showing ${filedCount} filed bug${filedCount === 1 ? '' : 's'}` : `${filedCount} filed bug${filedCount === 1 ? '' : 's'} hidden`} ·{' '}
                <button data-testid="filed-hidden-toggle" className="text-blue-300 hover:underline" onClick={() => setShowFiled(v => !v)}>{showFiled ? 'hide' : 'show'}</button>
              </span>
            )}
          </div>
        );
      })()}

      {/* Same-day bundle suggestions */}
      {renderSuggestions()}

      {/* Waiting for Buganizer (opened, not yet confirmed) */}
      {waitingEntries.length > 0 && (
        <div data-testid="waiting-group" className="rounded-[20px] border border-amber-500/30 bg-amber-500/[0.04] p-3 space-y-2">
          <p className="text-xs text-amber-100">
            <b>⏳ Waiting for Buganizer ({waitingEntries.length})</b>{' '}
            <span className="text-slate-400">
              {workerFresh
                ? 'RX95 checks Buganizer every minute and stamps FILED when it finds proof.'
                : "RX95's background helper looks offline, so confirmation waits until it's back. Use \"Mark filed anyway\" if you already filed it."}
            </span>
          </p>
          {waitingEntries.map(renderWaiting)}
        </div>
      )}

      {/* Pop-up blocked help */}
      {openQueue.length > 0 && (
        <div data-testid="popup-blocked" className="rounded-[20px] border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-100 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[260px] leading-relaxed">
            <b>Your browser blocked {openQueue.length} tab{openQueue.length === 1 ? '' : 's'}.</b> Browsers allow only one pop-up per click.
            Click the blocked pop-up icon at the right end of the address bar, choose <b>"Always allow pop-ups and redirects from {window.location.host}"</b>, then click <b>Open remaining</b>.
          </div>
          <button className="px-3 h-8 rounded-xl font-semibold bg-amber-500/25 border border-amber-500/50" onClick={openRemaining}>Open remaining ({openQueue.length})</button>
          <button className="px-2.5 h-8 rounded-xl text-amber-200/80 hover:bg-amber-500/10" onClick={() => setOpenQueue([])}>Dismiss</button>
        </div>
      )}

      {/* Filters */}
      <div className="rounded-[20px] border border-slate-800 bg-[#111827] p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-100"><Filter className="w-4 h-4 text-blue-400" /> Filter</div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5">
          <div>
            <label className={labelCls}>Tester</label>
            <select aria-label="Tester filter" className={inputCls} value={tester} onChange={e => setTester(e.target.value)}>
              <option value="all">All testers</option>
              {testers.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Test plan</label>
            <select aria-label="Plan filter" className={inputCls} value={planId} onChange={e => setPlanId(e.target.value)}>
              <option value="all">All plans</option>
              {planIds.map(p => <option key={p} value={p}>{planName(p)}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Day</label>
            <input aria-label="Day filter" type="date" className={inputCls} value={day} onChange={e => setDay(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>CUJ</label>
            <select aria-label="CUJ filter" className={inputCls} value={cuj} onChange={e => setCuj(e.target.value)}>
              <option value="all">All CUJs</option>
              {cujs.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select aria-label="Status filter" className={inputCls} value={stateFilter} onChange={e => setStateFilter(e.target.value as any)}>
              <option value="all">All</option>
              {(Object.keys(STATE_LABEL) as DraftState[]).map(s => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Search</label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
              <input aria-label="Search" className={`${inputCls} pl-7`} value={query} onChange={e => setQuery(e.target.value)} placeholder="Note, step, title…" />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-slate-400">{visible.length} bugs:</span>
          {(Object.keys(STATE_LABEL) as DraftState[]).map(s => (
            <span key={s} className={`px-2 py-0.5 rounded-full border ${STATE_STYLE[s]}`}>{STATE_LABEL[s]} {counts[s]}</span>
          ))}
        </div>
      </div>

      {/* Bulk actions */}
      <div className="sticky top-2 z-10 rounded-[20px] border border-slate-800 bg-[#0b1220]/95 backdrop-blur px-4 py-2.5 flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-300 font-semibold mr-1">{selected.size ? `${selectedCount} to open · ${selected.size} selected` : '0 selected'}</span>
        <button className="px-2.5 h-7 rounded-xl text-xs text-slate-200 hover:bg-slate-800" onClick={() => setSelected(new Set([...visible.map(b => b.id), ...shownGroups.map(g => g.bundle.id)]))}>Select all</button>
        <button className="px-2.5 h-7 rounded-xl text-xs text-slate-200 hover:bg-slate-800" onClick={selectAllReady}>Select ready</button>
        <button className="px-2.5 h-7 rounded-xl text-xs text-slate-200 hover:bg-slate-800" onClick={() => setSelected(new Set())}>Clear</button>
        <span className="w-px h-5 bg-slate-700 mx-1" />
        <button className="px-2.5 h-7 rounded-xl text-xs text-blue-200 hover:bg-blue-600/20" onClick={() => markSelected('ready')}>Mark ready</button>
        <button className="px-2.5 h-7 rounded-xl text-xs text-slate-300 hover:bg-slate-800" onClick={() => markSelected('draft')}>Back to draft</button>
        <button data-testid="bundle-selected" disabled={selectedBundleable.length < 2}
          className="px-2.5 h-7 rounded-xl text-xs font-semibold text-violet-200 hover:bg-violet-500/15 disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => createBundle(selectedBundleable, manualBundleTitle(selectedBundleable, refinedFor), undefined, 'manual')}>
          🧩 Bundle selected{selectedBundleable.length >= 2 ? ` (${selectedBundleable.length})` : ''}
        </button>
        <div className="flex-1" />
        {openQueue.length > 0 && (
          <button data-testid="open-remaining" className="px-3 h-8 rounded-xl text-xs font-semibold bg-amber-500/20 text-amber-100 border border-amber-500/40" onClick={openRemaining}>
            Open remaining ({openQueue.length})
          </button>
        )}
        <button
          data-testid="open-in-buganizer"
          disabled={selectedCount === 0}
          onClick={startOpen}
          className="px-3 h-8 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ExternalLink className="w-3.5 h-3.5" /> Open {selectedCount || ''} in Buganizer
        </button>
      </div>

      {/* Bug list */}
      <div className="space-y-3">
        {rows.length === 0 && (
          <div className="rounded-[20px] border border-slate-800 bg-[#111827] p-8 text-center text-sm text-slate-400">No bugs match these filters.</div>
        )}
        {rows.map(row => {
          if (row.kind === 'bundle') return renderBundleRow(row.group);
          const bug = row.bug;
          const d = draftFor(bug);
          const filed = effectiveFiled(bug);
          const repro = isReproRow(bug);
          const reprod = !filed && effectiveStatus(bug.status) === REPROD;
          return (
            <div key={bug.id} data-testid="triage-row" className={`rounded-[20px] border bg-[#111827] p-4 ${selected.has(bug.id) ? 'border-blue-500/60 ring-1 ring-blue-500/30' : 'border-slate-800'}`}>
              <div className="flex items-start gap-3">
                {/* Repro'd rows can be selected for "Bundle selected"; they're never opened as new issues */}
                <input type="checkbox" aria-label={`Select ${bug.id}`} className="mt-1 accent-blue-500" checked={selected.has(bug.id)} onChange={() => toggle(bug.id)} />
                <div className="flex-1 min-w-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-4">
                  {/* Original tester note */}
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      {filed && (
                        <span data-testid="row-filed-pill" className="px-2 py-0.5 rounded-full border bg-green-500/15 text-green-300 border-green-500/40 font-bold">FILED{filedStampLine(filed) ? ` · ${filedStampLine(filed)}` : ''}</span>
                      )}
                      {reprod && (
                        <span data-testid="row-reprod-pill" className="px-2 py-0.5 rounded-full border border-violet-500/50 bg-violet-500/15 text-violet-200 flex items-center gap-1"><Repeat className="w-3 h-3" /> Repro'd Issue</span>
                      )}
                      {!repro && (
                        <span className={`px-2 py-0.5 rounded-full border ${STATE_STYLE[d.state]}`}>{STATE_LABEL[d.state]}{d.state === 'filed' && d.issueId ? ` · b/${d.issueId}` : ''}</span>
                      )}
                      <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">{bug.feature || 'General'}</span>
                      {refinedFor(bug) && (
                        d.refinedAt === refinedFor(bug)!.at && !d.textEdited ? (
                          <span data-testid="rx95-refined-chip" className="px-2 py-0.5 rounded-full border border-violet-500/40 bg-violet-500/15 text-violet-200 flex items-center gap-1">
                            <Sparkles className="w-3 h-3" /> RX95 wording
                            <button className="ml-1 underline decoration-dotted text-violet-300 hover:text-white" onClick={() => useOriginalWording(bug)}>use original</button>
                          </span>
                        ) : (
                          <button data-testid="rx95-use-wording" className="px-2 py-0.5 rounded-full border border-violet-500/30 text-violet-300 hover:bg-violet-500/10 flex items-center gap-1" onClick={() => useRx95Wording(bug)}>
                            <Sparkles className="w-3 h-3" /> Use RX95 wording
                          </button>
                        )
                      )}
                    </div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-500 pt-0.5">Reporter's original</p>
                    {bug.title && <p className="text-sm font-semibold text-white leading-snug">{bug.title}</p>}
                    {(!bug.title || bug.note !== bug.title) && (
                      <p className={`${bug.title ? 'text-xs text-slate-300 line-clamp-3 whitespace-pre-line' : 'text-sm text-slate-100'} leading-snug`}>{bug.note}</p>
                    )}
                    <p className="text-[11px] text-slate-400">
                      {bug.testerName || 'Unknown'} · {bug.deviceName || 'Unknown device'} · {bug.formattedTime || localDay(bug.timestamp)}
                    </p>
                    <p className="text-[11px] text-slate-500 truncate">{planName(bug.planId)} › {bug.stepTitle}</p>
                    {repro && bug.environment && (
                      <p className="text-[11px] text-slate-500 truncate" data-testid="row-build">
                        Build: {[bug.environment.glassesFirmware, [bug.environment.phoneManufacturer, bug.environment.phoneModel].filter(Boolean).join(' '), bug.environment.androidVersion ? `Android ${bug.environment.androidVersion}` : ''].filter(Boolean).join(' · ') || 'not captured'}
                      </p>
                    )}
                  </div>

                  {repro ? renderReproPanel({
                    key: bug.id,
                    query: bug,
                    matches: matchesFor(bug),
                    comment: () => commentFor(bug),
                    onFollowUp: cand => followUp(bug, cand),
                    onFileNew: () => updateDraft(bug, { fileAsNew: true }),
                  }) : renderDraftFields({
                    key: bug.id,
                    d,
                    update: patch => updateDraft(bug, patch),
                    planId: bug.planId,
                    top: reprod && d.fileAsNew ? (
                      <button data-testid="repro-back-to-matches" className="px-2 py-0.5 rounded-full border border-violet-500/40 text-[11px] text-violet-200 hover:bg-violet-500/10" onClick={() => updateDraft(bug, { fileAsNew: false })}>
                        ← Back to RX95's possible existing bugs
                      </button>
                    ) : undefined,
                    onFiledAs: id => {
                      if (id && bug.filed?.issueId !== id) {
                        patchBug(bug.id, { filed: newFiled('new', id), filePending: undefined });
                        if (!showFiled) flash(`Stamped FILED as b/${id} and hidden. Use "show" in the filed bar to see it again.`);
                      } else if (!id && bug.filed?.via === 'new') {
                        patchBug(bug.id, { filed: undefined });
                      }
                    },
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Preview / dry-run modal: compact cards, expand one to review details */}
      {preview && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-[20px] border border-slate-700 bg-[#0f172a]" onClick={e => e.stopPropagation()} data-testid="preview-modal">
            <div className="px-5 pt-4 pb-3 border-b border-slate-800 space-y-1">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-50 flex items-center gap-2"><Bug className="w-4 h-4 text-rose-400" /> Review {preview.length} Buganizer form{preview.length === 1 ? '' : 's'}</h3>
                <button aria-label="Close preview" onClick={() => setPreview(null)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-slate-400">Dry run: nothing has been sent. Click a card to see its full description and link.</p>
                <div className="flex gap-1 text-[11px] flex-shrink-0">
                  <button data-testid="expand-all" className="px-2 h-6 rounded-lg text-slate-300 hover:bg-slate-800" onClick={() => setPreviewExpanded(new Set(preview.map(d => d.bugId)))}>Expand all</button>
                  <button data-testid="collapse-all" className="px-2 h-6 rounded-lg text-slate-300 hover:bg-slate-800" onClick={() => setPreviewExpanded(new Set())}>Collapse all</button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
              {preview.map((d, i) => {
                const u = buildBuganizerUrl(d);
                const c = componentById(d.componentId);
                const isExp = previewExpanded.has(d.bugId);
                const tooLong = u.length > MAX_SAFE_URL_LENGTH;
                return (
                  <div key={d.bugId} className={`rounded-2xl border bg-[#111827] text-xs ${tooLong ? 'border-amber-500/50' : 'border-slate-800'}`} data-testid="preview-item">
                    <button type="button" data-testid="preview-toggle" aria-expanded={isExp}
                      onClick={() => setPreviewExpanded(prev => { const n = new Set(prev); n.has(d.bugId) ? n.delete(d.bugId) : n.add(d.bugId); return n; })}
                      className="w-full text-left px-3 py-2 flex items-center gap-2">
                      <span className="text-slate-500 font-mono w-5 flex-shrink-0">{i + 1}.</span>
                      <span className="flex-1 min-w-0">
                        <span className="block font-semibold text-slate-100 truncate" title={d.title}>{d.title}</span>
                        <span className="block text-[11px] text-slate-400 truncate">
                          <b className="text-slate-300">{c ? c.name : d.componentId}</b> · {d.priority} · {d.type === 'BUG' ? 'Bug' : d.type}
                          {d.hotlistIds.length ? ` · hotlist ${d.hotlistIds.join(', ')}` : ''}{d.foundIn ? ` · found in ${d.foundIn}` : ''}{d.cc ? ` · cc ${d.cc}` : ''}
                        </span>
                      </span>
                      {tooLong && <span className="text-[10px] text-amber-300 flex-shrink-0">long link</span>}
                      <span className={`text-slate-400 flex-shrink-0 transition-transform ${isExp ? 'rotate-180' : ''}`}>▾</span>
                    </button>
                    {isExp && (
                      <div className="px-3 pb-3 space-y-1.5" data-testid="preview-details">
                        <div className="text-[11px] text-slate-400">Component {d.componentId}{c ? ` · ${c.path}` : ''}{d.assignee ? ` · assignee ${d.assignee}` : ''}</div>
                        <pre className="whitespace-pre-wrap text-[11px] text-slate-300 bg-[#0b1220] rounded-xl p-2 max-h-48 overflow-y-auto">{d.description}</pre>
                        <div className={`break-all text-[10px] ${tooLong ? 'text-amber-300' : 'text-slate-500'}`} data-testid="preview-url">{u}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="px-5 py-3 border-t border-slate-800 space-y-2.5">
              <label className="flex items-start gap-2 text-xs text-slate-300">
                <input type="checkbox" className="mt-0.5 accent-blue-500" checked={allowOpen} onChange={e => setAllowOpen(e.target.checked)} data-testid="allow-open" />
                <span>Open these as Buganizer tabs. Each tab is only a prefilled form - review it and click <b>Create</b> yourself.{preview.length > 1 ? <> To open all {preview.length} at once, allow pop-ups for <b>{window.location.host}</b> first.</> : null}</span>
              </label>
              <div className="flex justify-end gap-2">
                <button className="px-3 h-8 rounded-xl text-xs text-slate-200 hover:bg-slate-800 flex items-center gap-1.5" onClick={() => copyLinks(preview)}><Copy className="w-3.5 h-3.5" /> Copy links</button>
                <button disabled={!allowOpen} onClick={() => openTabs(preview)} data-testid="confirm-open"
                  className="px-3 h-8 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
                  <ExternalLink className="w-3.5 h-3.5" /> Open {preview.length} tab{preview.length === 1 ? '' : 's'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="fixed bottom-5 right-5 z-50 rounded-2xl bg-slate-800 border border-slate-700 text-slate-100 text-xs px-4 py-2.5 shadow-xl">{toast}</div>}
    </div>
  );
}
