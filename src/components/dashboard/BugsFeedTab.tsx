import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Image as ImageIcon, Trash2, Search, Filter } from 'lucide-react';
import { TestPlan, BugLog, RefinedBugText, ReproMatches } from '../../types';
import {
  REPROD,
  TRIAGE_STATUS_OPTIONS,
  currentReproMatches,
  effectiveFiled,
  effectiveStatus,
  filedPatch,
  filedStampLine,
  newFiled,
  normalizeIssueId
} from '../../utils/reproFollowUp';
import {
  TabBar,
  Rx95LiveChip,
  TAG_STYLE,
  chipCls,
  chipOff,
  chipOn,
  expandedCls,
  inputCls,
  labelCls,
  listBoxCls,
  priTagCls,
  rowActionCls,
  rowCls,
  rowOpenCls,
  smallBtnCls,
  tagCls
} from '../triageUi';
import { isStronglyReviewed, reviewedNow } from '../../utils/bugReview';
import { currentRefinement } from '../../utils/bugRefine';
import { toLocalHHMM } from '../../utils/bugTime';
import BuganizerTriage from '../BuganizerTriage';
import {
  defaultCategory,
  type BugTypeValue,
  type PriorityValue,
  type StatusValue,
  type GroupCategory
} from '../BundleSuggestionsPanel';
import { bundleCuj, saveDismissed, type ShownSuggestion } from '../../utils/bundleDraft';
import type { Rx95SuggestionsData } from '../../services/supabaseService';
import { rx95Stalled } from '../../utils/rx95Health';

export type FeedDraft = { title: string; note: string; time: string };

export type BugCategorizationMap = Record<
  string,
  {
    bugType?: 'Bug' | 'Setup Issue' | 'Known Issue' | 'Feature Request' | 'Misc Issue';
    priority?: 'P0' | 'P1' | 'P2';
    status?: 'Filed' | 'New' | "Repro'd Issue";
  }
>;

export type FeedRow =
  | { kind: 'bug'; bug: BugLog }
  | { kind: 'bundle'; id: string; members: BugLog[] }
  | { kind: 'suggestion'; id: string; shown: ShownSuggestion };

export interface BugsFeedTabProps {
  buganizerEnabled: boolean;
  bugsView: 'feed' | 'buganizer';
  setBugsView: React.Dispatch<React.SetStateAction<'feed' | 'buganizer'>>;
  testPlans: TestPlan[];
  bugLogs: BugLog[];
  bugById: Map<string, BugLog>;
  processedBugs: BugLog[];
  processedBugById: Map<string, BugLog>;
  buganizerBugs: BugLog[];
  newFeedBugs: BugLog[];
  reviewedFeedBugs: BugLog[];
  feedRows: FeedRow[];
  feedSuggestions: ShownSuggestion[];
  suggestionByBugId: Map<string, ShownSuggestion>;
  bugCategorizations: BugCategorizationMap;
  dismissedSuggestions: Set<string>;
  setDismissedSuggestions: React.Dispatch<React.SetStateAction<Set<string>>>;
  expandedFeedBundles: Set<string>;
  setExpandedFeedBundles: React.Dispatch<React.SetStateAction<Set<string>>>;
  suggestionsCollapsed: boolean;
  setSuggestionsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  feedNow: number;
  feedTab: 'new' | 'suggestions' | 'reviewed';
  setFeedTab: React.Dispatch<React.SetStateAction<'new' | 'suggestions' | 'reviewed'>>;
  expandedBugIds: Record<string, boolean>;
  toggleBugExpand: (bugId: string) => void;
  setStickyNewBugIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  feedToast: string | null;
  flashFeed: (msg: string) => void;
  buganizerFocus: { id: string; n: number } | null;
  setBuganizerFocus: React.Dispatch<React.SetStateAction<{ id: string; n: number } | null>>;
  rx95Suggestions?: Rx95SuggestionsData;
  onApplyBugRefinements?: (refinements: Record<string, RefinedBugText>) => void;
  onPatchBugLog?: (bugId: string, patch: Partial<BugLog>) => void;
  onPatchBugLogs?: (patches: Record<string, Partial<BugLog>>) => void;
  onApplyReproMatches?: (matches: Record<string, ReproMatches>) => void;
  onUpdateBugLog?: (updatedBug: BugLog | BugLog[]) => void;
  onDeleteBug: (bugId: string) => void;
  onWipeAllBugs?: () => void;
  openInFeed: (bugId?: string) => void;
  openInBuganizer: (bugId: string) => void;
  jumpToSuggestion: (sugId: string) => void;
  handleCategorizeAndBundle: (
    members: BugLog[],
    title: string,
    summary: string | undefined,
    cat: GroupCategory
  ) => void;
  unbundleFromFeed: (bundleId: string) => void;
  reviewedOf: (b: BugLog) => boolean;
  feedDraftFor: (bug: BugLog) => FeedDraft;
  feedDirty: (bug: BugLog) => boolean;
  setFeedDraft: (bug: BugLog, patch: Partial<FeedDraft>) => void;
  cancelFeedEdit: (bugId: string) => void;
  saveFeedEdit: (bug: BugLog) => void;
  markReviewed: (bugId: string) => void;
  moveToNew: (bugId: string) => void;
  handleUpdateBugCategorization: (
    bugId: string,
    field: 'bugType' | 'priority' | 'status',
    value: any
  ) => void;
  filedIssueDrafts: Record<string, string>;
  setFiledIssueDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setSelectedImagePreviewUrl: React.Dispatch<React.SetStateAction<string | null>>;
  todayStr: string;
  getLocalDateStr: (dateInput?: string | Date) => string;
  selectedPlanFilter: string;
  setSelectedPlanFilter: React.Dispatch<React.SetStateAction<string>>;
  bugPlanOptions: { planId: string; planName: string; count: number }[];
  selectedDateFilter: string;
  setSelectedDateFilter: React.Dispatch<React.SetStateAction<string>>;
  customDateInput: string;
  setCustomDateInput: React.Dispatch<React.SetStateAction<string>>;
  searchBugQuery: string;
  setSearchBugQuery: React.Dispatch<React.SetStateAction<string>>;
  isBugFilterMenuOpen: boolean;
  setIsBugFilterMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  selectedFeatureFilter: string;
  setSelectedFeatureFilter: React.Dispatch<React.SetStateAction<string>>;
  uniqueFeatures: string[];
  selectedDeviceFilter: string;
  setSelectedDeviceFilter: React.Dispatch<React.SetStateAction<string>>;
  uniqueDevices: string[];
  sortByDevice: 'newest' | 'oldest' | 'device-asc' | 'device-desc' | 'priority' | 'severity' | 'tester-asc' | 'tester-most';
  setSortByDevice: React.Dispatch<
    React.SetStateAction<'newest' | 'oldest' | 'device-asc' | 'device-desc' | 'priority' | 'severity' | 'tester-asc' | 'tester-most'>
  >;
  feedGroupBy: 'time' | 'tester' | 'device' | 'cuj';
  setFeedGroupBy: React.Dispatch<React.SetStateAction<'time' | 'tester' | 'device' | 'cuj'>>;
  selectedTesterFilters: string[];
  setSelectedTesterFilters: React.Dispatch<React.SetStateAction<string[]>>;
  isTesterFilterOpen: boolean;
  setIsTesterFilterOpen: React.Dispatch<React.SetStateAction<boolean>>;
  focusedBugId: string | null;
  setFocusedBugId: React.Dispatch<React.SetStateAction<string | null>>;
  bugTesterOptions: { name: string; count: number; devices: string[]; p0Count: number; p1Count: number }[];
}

export const BugsFeedTab: React.FC<BugsFeedTabProps> = ({
  buganizerEnabled,
  bugsView,
  setBugsView,
  testPlans,
  bugLogs,
  bugById,
  processedBugs,
  processedBugById,
  buganizerBugs,
  newFeedBugs,
  reviewedFeedBugs,
  feedRows,
  feedSuggestions,
  suggestionByBugId,
  bugCategorizations,
  dismissedSuggestions,
  setDismissedSuggestions,
  expandedFeedBundles,
  setExpandedFeedBundles,
  suggestionsCollapsed,
  setSuggestionsCollapsed,
  feedNow,
  feedTab,
  setFeedTab,
  expandedBugIds,
  toggleBugExpand,
  setStickyNewBugIds,
  feedToast,
  flashFeed,
  buganizerFocus,
  setBuganizerFocus,
  rx95Suggestions,
  onApplyBugRefinements,
  onPatchBugLog,
  onPatchBugLogs,
  onApplyReproMatches,
  onUpdateBugLog,
  onDeleteBug,
  onWipeAllBugs,
  openInFeed,
  openInBuganizer,
  jumpToSuggestion,
  handleCategorizeAndBundle,
  unbundleFromFeed,
  reviewedOf,
  feedDraftFor,
  feedDirty,
  setFeedDraft,
  cancelFeedEdit,
  saveFeedEdit,
  markReviewed,
  moveToNew,
  handleUpdateBugCategorization,
  filedIssueDrafts,
  setFiledIssueDrafts,
  setSelectedImagePreviewUrl,
  todayStr,
  getLocalDateStr,
  selectedPlanFilter,
  setSelectedPlanFilter,
  bugPlanOptions,
  selectedDateFilter,
  setSelectedDateFilter,
  customDateInput,
  setCustomDateInput,
  searchBugQuery,
  setSearchBugQuery,
  isBugFilterMenuOpen,
  setIsBugFilterMenuOpen,
  selectedFeatureFilter,
  setSelectedFeatureFilter,
  uniqueFeatures,
  selectedDeviceFilter,
  setSelectedDeviceFilter,
  uniqueDevices,
  sortByDevice,
  setSortByDevice,
  feedGroupBy,
  setFeedGroupBy,
  selectedTesterFilters,
  setSelectedTesterFilters,
  isTesterFilterOpen,
  setIsTesterFilterOpen,
  focusedBugId,
  setFocusedBugId,
  bugTesterOptions
}) => {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [isGroupByOpen, setIsGroupByOpen] = useState(false);
  const [filedStage, setFiledStage] = useState(false);
  const [stageCounts, setStageCounts] = useState<{ ready: number; filed: number }>({
    ready: 0,
    filed: 0,
  });
  const [collapsedInlineSugs, setCollapsedInlineSugs] = useState<Set<string>>(() => new Set());
  const [sugTickOverrides, setSugTickOverrides] = useState<Record<string, Record<string, boolean>>>({});
  const [sugCats, setSugCats] = useState<Record<string, GroupCategory>>({});
  const groupByRef = useRef<HTMLDivElement | null>(null);
  const testerFilterRef = useRef<HTMLDivElement | null>(null);

  // Close Group by and Tester filter popovers on outside click
  useEffect(() => {
    if (!isGroupByOpen && !isTesterFilterOpen) return;
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (isGroupByOpen && groupByRef.current && target && !groupByRef.current.contains(target)) {
        setIsGroupByOpen(false);
      }
      if (
        isTesterFilterOpen &&
        testerFilterRef.current &&
        target &&
        !testerFilterRef.current.contains(target)
      ) {
        setIsTesterFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isGroupByOpen, isTesterFilterOpen, setIsTesterFilterOpen]);

  // Ensure focusing a bug in Buganizer switches to the right stage (Ready to file vs Filed)
  useEffect(() => {
    if (!buganizerFocus) return;
    const raw = bugById.get(buganizerFocus.id);
    if (raw && effectiveFiled(raw)) {
      setFiledStage(true);
    } else {
      setFiledStage(false);
    }
  }, [buganizerFocus, bugById]);

  const fmtT = (iso?: string) => {
    const d = new Date(iso || '');
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  // Compute grouped sections for feedRows based on feedGroupBy ('time' | 'tester' | 'device' | 'cuj')
  const groupedSections = useMemo(() => {
    const rowLeadBug = (r: FeedRow): BugLog =>
      r.kind === 'bundle'
        ? r.members[0]
        : r.kind === 'suggestion'
        ? r.shown.members[0]
        : r.bug;
    const rowBugCount = (r: FeedRow): number =>
      r.kind === 'bundle'
        ? r.members.length
        : r.kind === 'suggestion'
        ? r.shown.members.length
        : 1;

    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = getLocalDateStr(yesterdayDate);

    // Reference time for "LAST HOUR": latest timestamp in feedRows (or feedNow if recent)
    let maxRowMs = 0;
    feedRows.forEach(r => {
      const ms = new Date(rowLeadBug(r).timestamp || '').getTime();
      if (!isNaN(ms) && ms > maxRowMs) maxRowMs = ms;
    });
    const refNowMs = maxRowMs > 0 ? Math.max(feedNow, maxRowMs) : feedNow;

    if (feedGroupBy === 'time') {
      const map = new Map<string, { key: string; label: string; count: number; rightMeta?: string; rows: FeedRow[] }>();
      feedRows.forEach(r => {
        const b = rowLeadBug(r);
        const d = new Date(b.timestamp || '');
        const ms = d.getTime();
        const dayStr = !isNaN(ms) ? getLocalDateStr(d) : '';
        let key = 'older';
        let label = 'OLDER';
        if (dayStr === todayStr) {
          if (!isNaN(ms) && refNowMs - ms <= 60 * 60 * 1000) {
            key = 'last-hour';
            label = 'LAST HOUR';
          } else {
            key = 'earlier-today';
            label = 'EARLIER TODAY';
          }
        } else if (dayStr === yesterdayStr) {
          key = 'yesterday';
          label = 'YESTERDAY';
        } else if (dayStr) {
          key = `day-${dayStr}`;
          label = d
            .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            .toUpperCase();
        }
        let sec = map.get(key);
        if (!sec) {
          sec = { key, label, count: 0, rows: [] };
          map.set(key, sec);
        }
        sec.count += rowBugCount(r);
        sec.rows.push(r);
      });
      return Array.from(map.values());
    }

    if (feedGroupBy === 'tester') {
      const map = new Map<
        string,
        {
          key: string;
          label: string;
          count: number;
          devices: Set<string>;
          latestIso?: string;
          latestMs: number;
          rows: FeedRow[];
        }
      >();
      feedRows.forEach(r => {
        const b = rowLeadBug(r);
        const rawTester = (b.testerName || (b as any).reporter || '').trim() || 'Unknown';
        const k = rawTester.toLowerCase();
        let sec = map.get(k);
        if (!sec) {
          sec = {
            key: `tester-${k}`,
            label: rawTester.toUpperCase(),
            count: 0,
            devices: new Set<string>(),
            latestIso: undefined,
            latestMs: 0,
            rows: [],
          };
          map.set(k, sec);
        }
        sec.count += rowBugCount(r);
        if (b.deviceName && b.deviceName.trim()) sec.devices.add(b.deviceName.trim());
        const ms = new Date(b.timestamp || '').getTime();
        if (!isNaN(ms) && ms > sec.latestMs) {
          sec.latestMs = ms;
          sec.latestIso = b.timestamp;
        }
        sec.rows.push(r);
      });
      const list = Array.from(map.values());
      if (sortByDevice === 'tester-most') {
        list.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      } else {
        list.sort((a, b) => a.label.localeCompare(b.label));
      }
      return list.map(s => {
        const devStr = Array.from(s.devices).join(', ');
        const latestStr = s.latestIso ? `latest ${fmtT(s.latestIso)}` : '';
        const rightMeta = [devStr, latestStr].filter(Boolean).join(' · ');
        return {
          key: s.key,
          label: s.label,
          count: s.count,
          rightMeta,
          rows: s.rows,
        };
      });
    }

    if (feedGroupBy === 'device') {
      const map = new Map<
        string,
        { key: string; label: string; count: number; latestIso?: string; latestMs: number; rows: FeedRow[] }
      >();
      feedRows.forEach(r => {
        const b = rowLeadBug(r);
        const rawDev = (b.deviceName || '').trim() || 'Unspecified';
        const k = rawDev.toLowerCase();
        let sec = map.get(k);
        if (!sec) {
          sec = {
            key: `device-${k}`,
            label: rawDev.toUpperCase(),
            count: 0,
            latestIso: undefined,
            latestMs: 0,
            rows: [],
          };
          map.set(k, sec);
        }
        sec.count += rowBugCount(r);
        const ms = new Date(b.timestamp || '').getTime();
        if (!isNaN(ms) && ms > sec.latestMs) {
          sec.latestMs = ms;
          sec.latestIso = b.timestamp;
        }
        sec.rows.push(r);
      });
      return Array.from(map.values())
        .sort((a, b) => a.label.localeCompare(b.label))
        .map(s => ({
          key: s.key,
          label: s.label,
          count: s.count,
          rightMeta: s.latestIso ? `latest ${fmtT(s.latestIso)}` : undefined,
          rows: s.rows,
        }));
    }

    // feedGroupBy === 'cuj'
    const map = new Map<
      string,
      { key: string; label: string; count: number; latestIso?: string; latestMs: number; rows: FeedRow[] }
    >();
    feedRows.forEach(r => {
      const b = rowLeadBug(r);
      const rawCuj = (b.feature || '').trim() || 'General';
      const k = rawCuj.toLowerCase();
      let sec = map.get(k);
      if (!sec) {
        sec = {
          key: `cuj-${k}`,
          label: rawCuj.toUpperCase(),
          count: 0,
          latestIso: undefined,
          latestMs: 0,
          rows: [],
        };
        map.set(k, sec);
      }
      sec.count += rowBugCount(r);
      const ms = new Date(b.timestamp || '').getTime();
      if (!isNaN(ms) && ms > sec.latestMs) {
        sec.latestMs = ms;
        sec.latestIso = b.timestamp;
      }
      sec.rows.push(r);
    });
    return Array.from(map.values())
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(s => ({
        key: s.key,
        label: s.label,
        count: s.count,
        rightMeta: s.latestIso ? `latest ${fmtT(s.latestIso)}` : undefined,
        rows: s.rows,
      }));
  }, [feedRows, feedGroupBy, todayStr, feedNow, sortByDevice, getLocalDateStr]);

  // Visible bug IDs in rendered order for J/K/Enter/R/1/2/3 keyboard navigation
  const visibleFeedBugIds = useMemo(() => {
    const ids: string[] = [];
    groupedSections.forEach(sec => {
      const isLongCollapsible = feedGroupBy !== 'time' && sec.rows.length > 3 && !expandedGroups[sec.key];
      const shownRows = isLongCollapsible ? sec.rows.slice(0, 3) : sec.rows;
      shownRows.forEach(r => {
        if (r.kind === 'bug') ids.push(r.bug.id);
        else if (r.kind === 'bundle') r.members.forEach(m => ids.push(m.id));
        else if (r.kind === 'suggestion') {
          if (!collapsedInlineSugs.has(r.id)) {
            r.shown.members.forEach(m => ids.push(m.id));
          }
        }
      });
    });
    return ids;
  }, [groupedSections, feedGroupBy, expandedGroups, collapsedInlineSugs]);

  // Keyboard shortcuts on Bugs Feed: J/K move focus, Enter expand, R mark reviewed, 1/2/3 set P0/P1/P2
  useEffect(() => {
    if (buganizerEnabled && bugsView !== 'feed') return;
    if (feedTab === 'suggestions') return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (visibleFeedBugIds.length === 0) return;

      const key = e.key;
      if (key === 'j' || key === 'J' || key === 'k' || key === 'K') {
        e.preventDefault();
        const curIdx = focusedBugId ? visibleFeedBugIds.indexOf(focusedBugId) : -1;
        const nextIdx =
          key === 'j' || key === 'J'
            ? curIdx < 0
              ? 0
              : Math.min(visibleFeedBugIds.length - 1, curIdx + 1)
            : curIdx <= 0
            ? 0
            : curIdx - 1;
        const nextId = visibleFeedBugIds[nextIdx];
        if (nextId) {
          setFocusedBugId(nextId);
          document.getElementById(`feed-row-${nextId}`)?.scrollIntoView({ block: 'nearest' });
        }
        return;
      }

      const activeId =
        focusedBugId && visibleFeedBugIds.includes(focusedBugId)
          ? focusedBugId
          : visibleFeedBugIds[0];
      if (!activeId) return;

      if (key === 'Enter') {
        // Avoid double-toggling if focus is already directly on the feed-row element (which has its own onKeyDown Enter)
        if (target && target.getAttribute('data-testid') === 'feed-row') return;
        e.preventDefault();
        setFocusedBugId(activeId);
        toggleBugExpand(activeId);
        return;
      }

      if (key === 'r' || key === 'R') {
        e.preventDefault();
        setFocusedBugId(activeId);
        markReviewed(activeId);
        flashFeed('Marked reviewed (R).');
        return;
      }

      if (key === '1' || key === '2' || key === '3') {
        e.preventDefault();
        const prio = key === '1' ? 'P0' : key === '2' ? 'P1' : 'P2';
        setFocusedBugId(activeId);
        if (feedTab === 'new') {
          setStickyNewBugIds(prev => new Set(prev).add(activeId));
        }
        handleUpdateBugCategorization(activeId, 'priority', prio);
        flashFeed(`Set priority to ${prio}.`);
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [
    buganizerEnabled,
    bugsView,
    feedTab,
    visibleFeedBugIds,
    focusedBugId,
    setFocusedBugId,
    toggleBugExpand,
    markReviewed,
    handleUpdateBugCategorization,
    flashFeed,
  ]);
  const renderFeedBundle = (
    row: { id: string; members: BugLog[] },
    renderBug: (b: BugLog) => React.ReactNode
  ) => {
    const open = expandedFeedBundles.has(row.id);
    const first = row.members[0];
    const bd = first.bundle!;
    const total = bd.memberIds?.length || row.members.length;
    // Header sums up all visible members: highest priority, most common type, Repro'd if any member is
    const rank = (p?: string) => (p === 'P0' || p === '0' ? 0 : p === 'P1' || p === '1' ? 1 : 2);
    const pri = ['P0', 'P1', 'P2'][
      Math.min(...row.members.map(m => rank(String(m.priority || 'P2'))))
    ];
    const typeCounts = new Map<string, number>();
    row.members.forEach(m => {
      const t = m.bugType || 'Bug';
      typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
    });
    const bugTypeLabel =
      Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Bug';
    const anyReprod = row.members.some(m => effectiveStatus(m.status) === REPROD);
    const testersN = new Set(
      row.members.map(m => (m.testerName || '').trim()).filter(Boolean)
    ).size;
    const allFiled = row.members.every(m => effectiveFiled(bugById.get(m.id) || m));
    const waiting = !allFiled && row.members.some(m => (bugById.get(m.id) || m).filePending);
    return (
      <div key={`bundle-${row.id}`} data-testid="feed-bundle-row" id={`feed-bundle-${row.id}`}>
        <div
          onClick={() =>
            setExpandedFeedBundles(prev => {
              const n = new Set(prev);
              n.has(row.id) ? n.delete(row.id) : n.add(row.id);
              return n;
            })
          }
          className={`${rowCls} flex-wrap ${open ? rowOpenCls : ''}`}
        >
          <span className={`${tagCls} ${TAG_STYLE.bundle}`}>Bundle ×{total}</span>
          <span className="flex-1 min-w-0 truncate text-slate-100 font-semibold">{bd.title}</span>
          {pri !== 'P2' && (
            <span
              className={`font-mono text-[10px] px-2.5 py-0.5 rounded-full border font-bold uppercase ${
                pri === 'P0' || pri === '0'
                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                  : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
              }`}
            >
              {pri}
            </span>
          )}
          {bugTypeLabel !== 'Bug' && (
            <span className="font-mono text-[10px] px-2.5 py-0.5 rounded-full border border-slate-700 bg-slate-800 text-slate-300">
              {bugTypeLabel}
            </span>
          )}
          {anyReprod && (
            <span className="font-mono text-[10px] px-2.5 py-0.5 rounded-full border font-bold bg-violet-500/15 text-violet-200 border-violet-500/40">
              REPRO'D
            </span>
          )}
          {allFiled && (
            <span className="font-mono text-[10px] px-2.5 py-0.5 rounded-full border font-black tracking-wider bg-green-500/15 text-green-300 border-green-500/40">
              FILED
            </span>
          )}
          {waiting && (
            <span className="font-mono text-[10px] px-2.5 py-0.5 rounded-full border font-bold bg-amber-500/15 text-amber-200 border-amber-500/40">
              WAITING
            </span>
          )}
          <span className="text-xs text-slate-400">
            {testersN} tester{testersN === 1 ? '' : 's'}
            {row.members.length < total ? ` · ${row.members.length} shown` : ''}
          </span>
        </div>
        {open && (
          <div className={`${expandedCls} space-y-3`} data-testid="feed-bundle-expanded">
            <div className="flex flex-wrap items-center gap-2 pt-3">
              {!allFiled && !waiting && (
                <button
                  type="button"
                  data-testid="feed-unbundle"
                  onClick={() => unbundleFromFeed(row.id)}
                  className="px-2.5 h-7 rounded-xl text-xs font-semibold border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                >
                  Unbundle
                </button>
              )}
              <span className="text-[11px] text-slate-500">
                Shows on the Buganizer tab as one bug. Change a single report's category below if needed.
              </span>
            </div>
            {row.members.map(m => renderBug(m))}
          </div>
        )}
      </div>
    );
  };

  const renderInlineSuggestion = (
    row: { id: string; shown: ShownSuggestion },
    renderBug: (b: BugLog) => React.ReactNode
  ) => {
    const { suggestion: sg, members: rawMembers, maybe } = row.shown;
    const members = rawMembers.map(m => processedBugById.get(m.id) || m);
    const collapsed = collapsedInlineSugs.has(sg.id);
    const overrides = sugTickOverrides[sg.id] || {};
    const isTicked = (id: string) => overrides[id] ?? !maybe.has(id);
    const ticked = new Set(members.filter(m => isTicked(m.id)).map(m => m.id));
    const tickedMembers = members.filter(m => ticked.has(m.id));
    const cat = sugCats[sg.id] || defaultCategory(tickedMembers.length ? tickedMembers : members);
    const setCat = (patch: Partial<GroupCategory>) =>
      setSugCats(prev => ({ ...prev, [sg.id]: { ...cat, ...patch } }));
    const setTick = (id: string, on: boolean) =>
      setSugTickOverrides(prev => ({
        ...prev,
        [sg.id]: { ...(prev[sg.id] || {}), [id]: on },
      }));
    const cuj = bundleCuj(members);
    const dismiss = () => {
      const n = new Set(dismissedSuggestions);
      n.add(sg.id);
      saveDismissed(n);
      setDismissedSuggestions(n);
      flashFeed('Dismissed bundle suggestion — reports restored to their time slots.');
    };

    return (
      <div
        key={`sug-${sg.id}`}
        id={`feed-sug-${sg.id}`}
        data-testid="inline-bundle-suggestion"
        data-suggestion-id={sg.id}
        className="border-l-[3px] border-l-violet-500 bg-violet-500/[0.05] border-b border-slate-800/80"
      >
        <div
          data-testid="inline-suggestion-header"
          className="px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
        >
          <span className="font-semibold text-violet-200 flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
            <span>🧩</span>
            <span className="font-bold text-violet-100 whitespace-nowrap">
              {members.length} similar reports
            </span>
            <span className="text-violet-300/80">·</span>
            <span className="text-violet-200 whitespace-nowrap">{cuj}</span>
            <span className="text-violet-300/80">·</span>
            <span className="text-white font-semibold" title={sg.reason || sg.title}>
              &ldquo;{sg.title}&rdquo;
            </span>
            <span className="text-violet-300/70 hidden sm:inline whitespace-nowrap">
              · suggested by RX95
            </span>
          </span>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              data-testid="suggestion-bundle"
              disabled={tickedMembers.length < 2}
              onClick={e => {
                e.stopPropagation();
                handleCategorizeAndBundle(tickedMembers, sg.title, sg.summary, cat);
                setSugCats(prev => {
                  const n = { ...prev };
                  delete n[sg.id];
                  return n;
                });
                setSugTickOverrides(prev => {
                  const n = { ...prev };
                  delete n[sg.id];
                  return n;
                });
              }}
              className="px-2.5 h-7 rounded-lg text-[11px] font-bold bg-violet-500/25 border border-violet-500/60 text-violet-100 hover:bg-violet-500/35 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
            >
              Bundle &amp; review
            </button>
            <button
              type="button"
              data-testid="suggestion-dismiss"
              onClick={e => {
                e.stopPropagation();
                dismiss();
              }}
              className="px-2.5 h-7 rounded-lg text-[11px] font-semibold border border-slate-700 bg-slate-800/90 text-slate-300 hover:bg-slate-700 cursor-pointer whitespace-nowrap"
            >
              Not similar
            </button>
            <button
              type="button"
              data-testid="suggestion-collapse"
              aria-label={collapsed ? 'Expand suggestion members' : 'Collapse suggestion members'}
              onClick={e => {
                e.stopPropagation();
                setCollapsedInlineSugs(prev => {
                  const n = new Set(prev);
                  n.has(sg.id) ? n.delete(sg.id) : n.add(sg.id);
                  return n;
                });
              }}
              className="px-2 h-7 rounded-lg text-xs font-bold text-violet-200 hover:bg-violet-500/20 cursor-pointer"
            >
              {collapsed ? '▸' : '▾'}
            </button>
          </div>
        </div>

        {!collapsed && (
          <>
            <div className="px-6 py-1.5 bg-violet-500/[0.03] border-t border-b border-slate-800/60 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
              <span className="text-violet-200/80 font-medium">
                Categorize {tickedMembers.length} ticked as:
              </span>
              <select
                aria-label="Suggestion bug type"
                data-testid="suggestion-bug-type"
                value={cat.bugType}
                onClick={e => e.stopPropagation()}
                onChange={e => setCat({ bugType: e.target.value as BugTypeValue })}
                className="bg-[#0f172a] border border-violet-500/40 rounded-lg px-2 py-0.5 text-[11px] text-slate-200 font-semibold focus:outline-none focus:border-violet-400 cursor-pointer"
              >
                {(
                  ['Bug', 'Setup Issue', 'Known Issue', 'Feature Request', 'Misc Issue'] as const
                ).map(o => (
                  <option key={o} value={o} className="bg-slate-900">
                    {o}
                  </option>
                ))}
              </select>
              <select
                aria-label="Suggestion priority"
                data-testid="suggestion-priority"
                value={cat.priority}
                onClick={e => e.stopPropagation()}
                onChange={e => setCat({ priority: e.target.value as PriorityValue })}
                className="bg-[#0f172a] border border-violet-500/40 rounded-lg px-2 py-0.5 text-[11px] text-slate-200 font-semibold focus:outline-none focus:border-violet-400 cursor-pointer"
              >
                {(['P0', 'P1', 'P2'] as const).map(o => (
                  <option key={o} value={o} className="bg-slate-900">
                    {o}
                  </option>
                ))}
              </select>
              <select
                aria-label="Suggestion status"
                data-testid="suggestion-status"
                value={cat.status}
                onClick={e => e.stopPropagation()}
                onChange={e => setCat({ status: e.target.value as StatusValue })}
                className="bg-[#0f172a] border border-violet-500/40 rounded-lg px-2 py-0.5 text-[11px] text-slate-200 font-semibold focus:outline-none focus:border-violet-400 cursor-pointer"
              >
                {(['New', "Repro'd Issue"] as const).map(o => (
                  <option key={o} value={o} className="bg-slate-900">
                    {o}
                  </option>
                ))}
              </select>
            </div>
            <div className="divide-y divide-slate-800/60">
            {members.map(m => {
              const on = ticked.has(m.id);
              const isBugExpanded = !!expandedBugIds[m.id];
              const isFocused = focusedBugId === m.id;
              const raw = (bugById.get(m.id) || m) as BugLog;
              const refined = currentRefinement(raw);
              const rowTitle = (
                refined?.title ||
                m.title ||
                (m.note || '').replace(/\s+/g, ' ').trim() ||
                'No description'
              ).slice(0, 200);
              return (
                <div key={m.id} id={`feed-row-${m.id}`}>
                  <div
                    data-testid="suggestion-member"
                    data-bug-id={m.id}
                    data-focused={isFocused ? 'true' : undefined}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setFocusedBugId(m.id);
                      toggleBugExpand(m.id);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        setFocusedBugId(m.id);
                        toggleBugExpand(m.id);
                      }
                    }}
                    className={`pl-6 pr-3.5 py-2 flex items-center gap-2.5 text-xs hover:bg-slate-800/40 cursor-pointer transition ${
                      on ? '' : 'opacity-50'
                    } ${isFocused ? 'bg-blue-500/[0.08] shadow-[inset_3px_0_0_#3b82f6]' : ''}`}
                  >
                    <span className="text-violet-400/80 font-mono select-none">└</span>
                    <input
                      type="checkbox"
                      data-testid="suggestion-member-checkbox"
                      aria-label={`Include report from ${m.testerName || 'Unknown'}`}
                      checked={on}
                      onClick={e => e.stopPropagation()}
                      onChange={e => setTick(m.id, e.target.checked)}
                      className="accent-violet-400 cursor-pointer"
                    />
                    <span className="text-[10.5px] text-slate-400 w-[58px] whitespace-nowrap font-mono">
                      {fmtT(m.timestamp)}
                    </span>
                    <span className="hidden md:inline text-[11.5px] text-slate-400 truncate max-w-[150px]">
                      {`${m.testerName || 'Unknown'} · ${m.deviceName || '?'}`}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-slate-200" title={m.note}>
                      {rowTitle}
                    </span>
                    {m.imageUrl && /^(data:image\/|https?:\/\/|blob:|\/)/i.test(m.imageUrl) && (
                      <ImageIcon className="w-3.5 h-3.5 text-blue-300 flex-shrink-0" />
                    )}
                    {String(m.priority || 'P2') !== 'P2' && (
                      <span className={priTagCls(String(m.priority))}>{m.priority}</span>
                    )}
                  </div>
                  {isBugExpanded && renderBug(m)}
                </div>
              );
            })}
            </div>
          </>
        )}
      </div>
    );
  };

  const dayValue = selectedDateFilter === 'custom' ? customDateInput : '';
  const moreActive =
    selectedFeatureFilter !== 'all' ||
    selectedDeviceFilter !== 'all' ||
    sortByDevice !== 'newest' ||
    (selectedDateFilter !== 'all' && selectedDateFilter !== 'custom');

  const isReviewStage = !buganizerEnabled || bugsView === 'feed';
  const isReadyStage = buganizerEnabled && bugsView === 'buganizer' && !filedStage;
  const isFiledStage = buganizerEnabled && bugsView === 'buganizer' && filedStage;

  return (
    <div className="space-y-4" data-testid="bugs-feed">
      {/* Unified 3-stage pipeline top bar: ① To review · ② Ready to file · ③ Filed + RX95 chip + Group by / Tester / Plan / Day / Search / More */}
      <div className="flex flex-wrap items-center gap-2" data-testid="bugs-pipeline-bar">
        <div className="flex flex-wrap items-center gap-2" data-testid="bugs-pipeline-tabs">
          <div className="inline-flex items-center bg-[#0f172a] border border-slate-800 rounded-xl p-0.5 gap-0.5">
            <button
              type="button"
              data-testid="pipeline-tab-review"
              onClick={() => {
                setFiledStage(false);
                setFeedTab('new');
                setBugsView('feed');
              }}
              className={`px-3 h-7 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                isReviewStage
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-300 hover:bg-slate-800/80'
              }`}
            >
              <span>① To review</span>
              <span
                data-testid="pipeline-count-review"
                className={`font-mono text-[10.5px] px-1.5 py-0.2 rounded-full ${
                  isReviewStage ? 'bg-blue-700/80 text-white' : 'bg-slate-800 text-slate-300'
                }`}
              >
                {newFeedBugs.length}
              </span>
            </button>
            {buganizerEnabled && (
              <>
                <button
                  type="button"
                  data-testid="pipeline-tab-ready"
                  onClick={() => {
                    setFiledStage(false);
                    setBugsView('buganizer');
                  }}
                  className={`px-3 h-7 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                    isReadyStage
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800/80'
                  }`}
                >
                  <span>② Ready to file</span>
                  <span
                    data-testid="pipeline-count-ready"
                    className={`font-mono text-[10.5px] px-1.5 py-0.2 rounded-full ${
                      isReadyStage ? 'bg-blue-700/80 text-white' : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {stageCounts.ready}
                  </span>
                </button>
                <button
                  type="button"
                  data-testid="pipeline-tab-filed"
                  onClick={() => {
                    setFiledStage(true);
                    setBugsView('buganizer');
                  }}
                  className={`px-3 h-7 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                    isFiledStage
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800/80'
                  }`}
                >
                  <span>③ Filed</span>
                  <span
                    data-testid="pipeline-count-filed"
                    className={`font-mono text-[10.5px] px-1.5 py-0.2 rounded-full ${
                      isFiledStage ? 'bg-blue-700/80 text-white' : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {stageCounts.filed}
                  </span>
                </button>
              </>
            )}
          </div>
          <Rx95LiveChip
            heartbeatAt={rx95Suggestions?.heartbeat?.at}
            nowMs={feedNow}
            stalled={rx95Stalled(rx95Suggestions?.heartbeat)}
            jobsInProgress={
              (rx95Suggestions?.heartbeat?.queues?.refine || 0) +
              (rx95Suggestions?.heartbeat?.queues?.match || 0) +
              (rx95Suggestions?.heartbeat?.queues?.bundle || 0)
            }
            testid="feed-rx95-chip"
          />
        </div>
        <div className="flex-1" />

        {/* Group by dropdown (`Group by: Time ▾`) */}
        <div className="relative" ref={groupByRef}>
          <button
            type="button"
            data-testid="feed-group-by"
            onClick={() => setIsGroupByOpen(v => !v)}
            className={`${chipCls} ${feedGroupBy !== 'time' || isGroupByOpen ? chipOn : chipOff}`}
          >
            <span>
              Group by:{' '}
              <b className="text-white">
                {feedGroupBy === 'time'
                  ? 'Time'
                  : feedGroupBy === 'tester'
                  ? 'Tester'
                  : feedGroupBy === 'device'
                  ? 'Device'
                  : 'CUJ'}
              </b>{' '}
              ▾
            </span>
          </button>
          {isGroupByOpen && (
            <div
              data-testid="feed-group-by-popover"
              className="absolute right-0 z-30 mt-1.5 w-44 rounded-xl border border-slate-700 bg-[#0f172a] p-1.5 shadow-2xl text-xs space-y-0.5"
            >
              {(
                [
                  { key: 'time', label: 'Time (default)' },
                  { key: 'tester', label: 'Tester' },
                  { key: 'device', label: 'Device' },
                  { key: 'cuj', label: 'CUJ' },
                ] as const
              ).map(opt => (
                <button
                  key={opt.key}
                  type="button"
                  data-testid={`group-by-${opt.key}`}
                  onClick={() => {
                    setFeedGroupBy(opt.key);
                    setIsGroupByOpen(false);
                  }}
                  className={`w-full px-2.5 py-1.5 rounded-lg text-left flex items-center gap-2 cursor-pointer ${
                    feedGroupBy === opt.key
                      ? 'bg-blue-600/20 text-white font-semibold'
                      : 'text-slate-300 hover:bg-slate-800/80'
                  }`}
                >
                  <span className="text-[10px]">{feedGroupBy === opt.key ? '●' : '○'}</span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Tester multi-select filter (`Tester: All (N) ▾`) */}
        <div className="relative" ref={testerFilterRef}>
          <button
            type="button"
            data-testid="feed-tester-filter"
            onClick={() => setIsTesterFilterOpen(v => !v)}
            className={`${chipCls} ${
              selectedTesterFilters.length > 0 || isTesterFilterOpen ? chipOn : chipOff
            }`}
          >
            <span>
              Tester:{' '}
              <b className="text-white">
                {selectedTesterFilters.length === 0
                  ? `All (${bugTesterOptions.length})`
                  : selectedTesterFilters.length === 1
                  ? selectedTesterFilters[0]
                  : `${selectedTesterFilters.length} selected`}
              </b>{' '}
              ▾
            </span>
          </button>
          {isTesterFilterOpen && (
            <div
              data-testid="feed-tester-popover"
              className="absolute right-0 z-30 mt-1.5 w-56 rounded-xl border border-slate-700 bg-[#0f172a] p-2 shadow-2xl text-xs space-y-1 max-h-72 overflow-y-auto"
            >
              <button
                type="button"
                data-testid="tester-filter-all"
                onClick={() => setSelectedTesterFilters([])}
                className={`w-full px-2.5 py-1.5 rounded-lg text-left flex items-center justify-between cursor-pointer ${
                  selectedTesterFilters.length === 0
                    ? 'bg-blue-600/20 text-white font-semibold'
                    : 'text-slate-300 hover:bg-slate-800/80'
                }`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    readOnly
                    checked={selectedTesterFilters.length === 0}
                    className="accent-blue-500 pointer-events-none"
                  />
                  <span>All testers</span>
                </span>
                <span className="font-mono text-[11px] text-slate-400">{bugLogs.length}</span>
              </button>
              {bugTesterOptions.map(opt => {
                const checked = selectedTesterFilters.some(
                  t => t.toLowerCase() === opt.name.toLowerCase()
                );
                return (
                  <button
                    key={opt.name}
                    type="button"
                    data-testid="tester-filter-option"
                    data-tester-name={opt.name}
                    onClick={() => {
                      setSelectedTesterFilters(prev => {
                        const exists = prev.some(
                          t => t.toLowerCase() === opt.name.toLowerCase()
                        );
                        if (exists) {
                          return prev.filter(
                            t => t.toLowerCase() !== opt.name.toLowerCase()
                          );
                        }
                        return [...prev, opt.name];
                      });
                    }}
                    className={`w-full px-2.5 py-1.5 rounded-lg text-left flex items-center justify-between cursor-pointer ${
                      checked
                        ? 'bg-blue-600/20 text-white font-semibold'
                        : 'text-slate-300 hover:bg-slate-800/80'
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <input
                        type="checkbox"
                        readOnly
                        checked={checked}
                        className="accent-blue-500 pointer-events-none"
                      />
                      <span className="truncate">{opt.name}</span>
                    </span>
                    <span className="font-mono text-[11px] text-slate-400">{opt.count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <select
          aria-label="Plan filter"
          data-testid="feed-plan"
          className={`${inputCls} !w-auto max-w-[170px]`}
          value={selectedPlanFilter}
          onChange={e => setSelectedPlanFilter(e.target.value)}
        >
          <option value="all">All plans ({bugLogs.length})</option>
          {bugPlanOptions.map(opt => (
            <option key={opt.planId} value={opt.planId}>
              {opt.planName} ({opt.count})
            </option>
          ))}
        </select>
        <input
          aria-label="Day filter"
          data-testid="feed-day"
          type="date"
          className={`${inputCls} !w-[132px] [color-scheme:dark]`}
          value={dayValue}
          onChange={e => {
            const v = e.target.value;
            if (v) {
              setSelectedDateFilter('custom');
              setCustomDateInput(v);
            } else {
              setSelectedDateFilter('all');
              setCustomDateInput('');
            }
          }}
        />
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
          <input
            aria-label="Search bugs"
            data-testid="feed-search"
            className={`${inputCls} pl-7 !w-32`}
            value={searchBugQuery}
            onChange={e => setSearchBugQuery(e.target.value)}
            placeholder="Search…"
          />
        </div>
        <div className="relative">
          <button
            type="button"
            data-testid="feed-more-toggle"
            className={`${chipCls} ${isBugFilterMenuOpen || moreActive ? chipOn : chipOff}`}
            onClick={() => setIsBugFilterMenuOpen(!isBugFilterMenuOpen)}
          >
            <Filter className="w-3.5 h-3.5" /> More ▾
          </button>
          {isBugFilterMenuOpen && (
            <div
              data-testid="feed-more-popover"
              className="absolute right-0 z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-700 bg-[#0f172a] p-3 space-y-2.5 shadow-2xl"
            >
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
                  Date range
                </label>
                <select
                  className={inputCls}
                  value={selectedDateFilter}
                  onChange={e => setSelectedDateFilter(e.target.value)}
                >
                  <option value="all">All dates</option>
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="7days">Last 7 days</option>
                  <option value="30days">Last 30 days</option>
                  <option value="custom">Specific date (header)</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
                  CUJ
                </label>
                <select
                  className={inputCls}
                  value={selectedFeatureFilter}
                  onChange={e => setSelectedFeatureFilter(e.target.value)}
                >
                  <option value="all">All CUJs</option>
                  {uniqueFeatures.map(feat => (
                    <option key={feat} value={feat}>
                      {feat}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
                  Device
                </label>
                <select
                  className={inputCls}
                  value={selectedDeviceFilter}
                  onChange={e => setSelectedDeviceFilter(e.target.value)}
                >
                  <option value="all">All devices</option>
                  {uniqueDevices.map(dev => (
                    <option key={dev} value={dev}>
                      {dev}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
                  Sort
                </label>
                <select
                  className={inputCls}
                  value={sortByDevice}
                  onChange={e => setSortByDevice(e.target.value as any)}
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="priority">Priority (P0 first)</option>
                  <option value="tester-asc">Tester (A → Z)</option>
                  <option value="tester-most">Tester (most bugs)</option>
                  <option value="device-asc">Device (A → Z)</option>
                  <option value="device-desc">Device (Z → A)</option>
                </select>
              </div>
              <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  className={smallBtnCls}
                  onClick={() => {
                    setSelectedDateFilter('all');
                    setSelectedFeatureFilter('all');
                    setSelectedDeviceFilter('all');
                    setSelectedPlanFilter('all');
                    setSelectedTesterFilters([]);
                    setFeedGroupBy('time');
                    setSortByDevice('newest');
                    setCustomDateInput('');
                  }}
                >
                  Reset filters
                </button>
                {bugLogs.length > 0 && onWipeAllBugs && (
                  <button
                    type="button"
                    className="px-2.5 h-7 rounded-xl text-xs font-semibold border border-rose-500/30 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Are you sure you want to wipe all ${bugLogs.length} logged bug(s)? This will permanently remove all defect logs.`
                        )
                      )
                        onWipeAllBugs();
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5 inline mr-1" />
                    Wipe all bugs
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stage ② Ready to file & Stage ③ Filed (mounted when buganizerEnabled so counts stay live) */}
      {buganizerEnabled && (
        <div className={bugsView === 'buganizer' ? '' : 'hidden'}>
          <BuganizerTriage
            bugs={buganizerBugs}
            bugCategorizations={bugCategorizations}
            dismissed={dismissedSuggestions}
            onDismissedChange={setDismissedSuggestions}
            nowMs={feedNow}
            plans={testPlans}
            onApplyRefinements={onApplyBugRefinements}
            onPatchBugLog={onPatchBugLog}
            onPatchBugLogs={onPatchBugLogs}
            onApplyReproMatches={onApplyReproMatches}
            rx95Suggestions={rx95Suggestions}
            onOpenBugsFeed={openInFeed}
            focusBug={buganizerFocus}
            onFocused={() => setBuganizerFocus(null)}
            pipelineStage={filedStage ? 'filed' : 'ready'}
            onStageChange={stage => {
              if (stage === 'review') {
                setFiledStage(false);
                setFeedTab('new');
                setBugsView('feed');
              } else if (stage === 'ready') {
                setFiledStage(false);
                setBugsView('buganizer');
              } else {
                setFiledStage(true);
                setBugsView('buganizer');
              }
            }}
            filteredBugIds={processedBugs.map(b => b.id)}
            feedGroupBy={feedGroupBy}
            sortByDevice={sortByDevice}
            todayStr={todayStr}
            getLocalDateStr={getLocalDateStr}
            onMoveToReview={bugId => {
              moveToNew(bugId);
              flashFeed('Moved back to ① To review.');
            }}
            onCountsChange={setStageCounts}
          />
        </div>
      )}

      {/* Stage ① To review */}
      {isReviewStage &&
        (() => {
          const fmtT = (iso?: string) => {
            const d = new Date(iso || '');
            return Number.isNaN(d.getTime())
              ? ''
              : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          };
          const renderFeedBug = (bug: BugLog) => {
            const isBugExpanded = !!expandedBugIds[bug.id];
            const isFocused = focusedBugId === bug.id;
            const raw = (bugById.get(bug.id) || bug) as BugLog;
            const filed = effectiveFiled(raw);
            const pending = !filed && raw.filePending;
            const reprod = !filed && effectiveStatus(bug.status) === REPROD;
            const refined = currentRefinement(raw);
            const rowTitle = (
              refined?.title ||
              bug.title ||
              (bug.note || '').replace(/\s+/g, ' ').trim() ||
              'No description'
            ).slice(0, 200);
            const reviewed = reviewedOf(bug);
            const strong = isStronglyReviewed(raw);
            return (
              <div key={bug.id} id={`feed-row-${bug.id}`}>
                <div
                  data-testid="feed-row"
                  data-bug-id={bug.id}
                  data-focused={isFocused ? 'true' : undefined}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setFocusedBugId(bug.id);
                    toggleBugExpand(bug.id);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      setFocusedBugId(bug.id);
                      toggleBugExpand(bug.id);
                    }
                  }}
                  className={`${rowCls} ${isBugExpanded ? rowOpenCls : ''} ${
                    isFocused ? 'bg-blue-500/[0.08] shadow-[inset_3px_0_0_#3b82f6]' : ''
                  }`}
                >
                  <span className="text-[10.5px] text-slate-400 w-[58px] whitespace-nowrap font-mono">
                    {fmtT(bug.timestamp)}
                  </span>
                  <span className="hidden md:inline text-[11.5px] text-slate-400 truncate max-w-[150px]">
                    {feedGroupBy === 'tester'
                      ? bug.deviceName || '?'
                      : feedGroupBy === 'device'
                      ? bug.testerName || 'Unknown'
                      : `${bug.testerName || 'Unknown'} · ${bug.deviceName || '?'}`}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-slate-100" title={bug.note}>
                    {rowTitle}
                  </span>
                  {bug.imageUrl && /^(data:image\/|https?:\/\/|blob:|\/)/i.test(bug.imageUrl) && (
                    <ImageIcon className="w-3.5 h-3.5 text-blue-300 flex-shrink-0" />
                  )}
                  <span className="hidden lg:inline text-[11.5px] text-slate-400 truncate max-w-[220px]" title={bug.feature || 'General'}>
                    {bug.feature || 'General'}
                  </span>
                  {(bug.bugType || 'Bug') !== 'Bug' && (
                    <span data-testid="feed-type-chip" className={`${tagCls} ${TAG_STYLE.new}`}>
                      {bug.bugType}
                    </span>
                  )}
                  {String(bug.priority || 'P2') !== 'P2' && (
                    <span data-testid="feed-priority-chip" className={priTagCls(String(bug.priority))}>
                      {bug.priority}
                    </span>
                  )}
                  {feedTab === 'new' && reviewed && (
                    <span data-testid="feed-reviewed-chip" className={`${tagCls} ${TAG_STYLE.filed}`}>
                      ✓ REVIEWED
                    </span>
                  )}
                  {filed && (
                    <span
                      data-testid="feed-filed-chip"
                      className={`${tagCls} ${TAG_STYLE.filed} font-black`}
                    >
                      FILED
                    </span>
                  )}
                  {pending && (
                    <span
                      data-testid="feed-waiting-chip"
                      title="Opened in Buganizer - RX95 stamps it FILED once it finds it there"
                      className={`${tagCls} ${
                        raw.filePending!.expired ? TAG_STYLE.expired : TAG_STYLE.waiting
                      }`}
                    >
                      {raw.filePending!.expired ? 'NOT FOUND' : 'WAITING'}
                    </span>
                  )}
                  {reprod && (
                    <span data-testid="feed-reprod-chip" className={`${tagCls} ${TAG_STYLE.repro}`}>
                      REPRO'D
                    </span>
                  )}
                  {raw.bundle && (
                    <span className={`${tagCls} ${TAG_STYLE.bundle}`}>BUNDLED</span>
                  )}
                </div>
                {isBugExpanded && (
                  <div data-testid="feed-row-expanded" className={expandedCls}>
                    {(() => {
                      const d = feedDraftFor(bug);
                      const dirty = feedDirty(bug);
                      const canEditText = !!onUpdateBugLog;
                      const loggedAt = new Date(bug.timestamp);
                      const meta = [
                        bug.testerName,
                        bug.deviceName,
                        bug.stepTitle,
                        bug.feature && bug.feature !== 'General' ? bug.feature : ''
                      ].filter(Boolean);
                      const hasPhoto = !!(
                        bug.imageUrl && /^(data:image\/|https?:\/\/|blob:|\/)/i.test(bug.imageUrl)
                      );
                      const fieldCls =
                        'w-full bg-[#0f172a] border border-slate-700 rounded-xl px-2.5 py-1.5 text-slate-100 focus:outline-none focus:border-blue-500 read-only:opacity-80 placeholder:text-slate-500 placeholder:font-normal';
                      return (
                        <>
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            {!strong &&
                              (reviewed ? (
                                <button
                                  type="button"
                                  data-testid="move-to-new"
                                  className={smallBtnCls}
                                  onClick={() => {
                                    moveToNew(bug.id);
                                    flashFeed('Moved back to New.');
                                  }}
                                >
                                  ↩ Move back to New
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  data-testid="mark-reviewed"
                                  className="px-2.5 h-7 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white"
                                  onClick={() => {
                                    setStickyNewBugIds(prev => {
                                      if (!prev.has(bug.id)) return prev;
                                      const n = new Set(prev);
                                      n.delete(bug.id);
                                      return n;
                                    });
                                    markReviewed(bug.id);
                                    flashFeed('Marked reviewed — moved to ② Ready to file.');
                                  }}
                                >
                                  ✓ Mark reviewed
                                </button>
                              ))}
                            {buganizerEnabled && (
                              <button
                                type="button"
                                data-testid="feed-open-buganizer"
                                className={smallBtnCls}
                                onClick={() => openInBuganizer(bug.id)}
                              >
                                Open in Ready to file ↗
                              </button>
                            )}
                            <button
                              type="button"
                              data-testid="feed-delete-bug"
                              onClick={() => onDeleteBug(bug.id)}
                              className="ml-auto px-2 h-7 rounded-xl text-[11px] font-semibold text-slate-400 hover:text-rose-300 hover:bg-rose-950/40"
                              title="Delete Bug Log"
                            >
                              <Trash2 className="w-3.5 h-3.5 inline mr-1" />
                              Delete
                            </button>
                          </div>
                          <p data-testid="feed-meta" className="text-[11px] text-slate-400 mb-3">
                            {meta.join(' · ')}
                            {meta.length ? ' · ' : ''}Logged {fmtT(bug.timestamp)}{' '}
                            {loggedAt.toLocaleDateString([], { month: 'short', day: 'numeric' })}
                            {bug.originalTimestamp
                              ? ` (first logged ${new Date(
                                  bug.originalTimestamp
                                ).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})`
                              : ''}
                            {refined ? ' · title cleaned up by RX95' : ''}
                          </p>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                            <div className="md:col-span-2 space-y-3">
                              <div className="space-y-2.5" data-testid="feed-edit-form">
                                <div className="flex gap-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between">
                                      <label className={labelCls}>Title</label>
                                      <span className="text-[10px] text-slate-500 mb-1">
                                        {d.title.length}/120
                                      </span>
                                    </div>
                                    <input
                                      data-testid="feed-edit-title"
                                      value={d.title}
                                      maxLength={120}
                                      readOnly={!canEditText}
                                      onChange={e => setFeedDraft(bug, { title: e.target.value })}
                                      placeholder="Short summary of the bug"
                                      className={`${fieldCls} text-sm font-semibold`}
                                    />
                                  </div>
                                  <div className="w-28 flex-shrink-0">
                                    <label className={labelCls} title="Same day only">
                                      Time
                                    </label>
                                    <input
                                      type="time"
                                      data-testid="feed-edit-time"
                                      value={d.time}
                                      max={
                                        getLocalDateStr(bug.originalTimestamp || bug.timestamp) ===
                                        todayStr
                                          ? toLocalHHMM(new Date().toISOString())
                                          : undefined
                                      }
                                      readOnly={!canEditText}
                                      onChange={e => setFeedDraft(bug, { time: e.target.value })}
                                      className={`${fieldCls} text-xs [color-scheme:dark]`}
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className={labelCls}>Description</label>
                                  <textarea
                                    data-testid="feed-edit-description"
                                    rows={4}
                                    value={d.note}
                                    readOnly={!canEditText}
                                    onChange={e => setFeedDraft(bug, { note: e.target.value })}
                                    placeholder="Steps to reproduce, expected vs. actual"
                                    className={`${fieldCls} text-xs leading-relaxed`}
                                  />
                                </div>
                                {dirty && (
                                  <div className="flex items-center justify-end gap-2">
                                    <span className="text-[10px] text-slate-400 mr-auto">
                                      Unsaved changes · save to carry over to Ready to file.
                                    </span>
                                    <button
                                      type="button"
                                      data-testid="feed-edit-cancel"
                                      onClick={() => cancelFeedEdit(bug.id)}
                                      className="px-3 h-7 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      data-testid="feed-edit-save"
                                      disabled={!d.title.trim() && !d.note.trim()}
                                      onClick={() => saveFeedEdit(bug)}
                                      className="px-3 h-7 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40"
                                    >
                                      Save
                                    </button>
                                  </div>
                                )}
                              </div>

                              {/* Bug Triage Controls */}
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                                <div>
                                  <label className={labelCls}>Bug Type</label>
                                  <select
                                    value={bugCategorizations[bug.id]?.bugType || bug.bugType || 'Bug'}
                                    onChange={e =>
                                      handleUpdateBugCategorization(bug.id, 'bugType', e.target.value)
                                    }
                                    className={`${inputCls} cursor-pointer`}
                                  >
                                    {(
                                      [
                                        'Bug',
                                        'Setup Issue',
                                        'Known Issue',
                                        'Feature Request',
                                        'Misc Issue'
                                      ] as const
                                    ).map(opt => (
                                      <option key={opt} value={opt} className="bg-slate-900">
                                        {opt}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label className={labelCls}>Priority</label>
                                  <select
                                    value={bugCategorizations[bug.id]?.priority || bug.priority || 'P2'}
                                    onChange={e =>
                                      handleUpdateBugCategorization(bug.id, 'priority', e.target.value)
                                    }
                                    className={`${inputCls} cursor-pointer`}
                                  >
                                    {(['P0', 'P1', 'P2'] as const).map(opt => (
                                      <option key={opt} value={opt} className="bg-slate-900">
                                        {opt}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label className={labelCls}>Status</label>
                                  <select
                                    data-testid="feed-status"
                                    value={effectiveStatus(
                                      bugCategorizations[bug.id]?.status || bug.status
                                    )}
                                    onChange={e =>
                                      handleUpdateBugCategorization(bug.id, 'status', e.target.value)
                                    }
                                    className={`w-full bg-[#0f172a] border rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:border-blue-500 cursor-pointer ${
                                      effectiveStatus(
                                        bugCategorizations[bug.id]?.status || bug.status
                                      ) === REPROD
                                        ? 'border-violet-500/70 text-violet-200 bg-violet-500/10'
                                        : 'border-slate-700 text-slate-100'
                                    }`}
                                  >
                                    {TRIAGE_STATUS_OPTIONS.map(opt => (
                                      <option key={opt} value={opt} className="bg-slate-900">
                                        {opt}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                              {effectiveStatus(bugCategorizations[bug.id]?.status || bug.status) ===
                                REPROD && (
                                <p className="text-[11px] text-slate-400" data-testid="feed-repro-hint">
                                  💡 &ldquo;Repro&rsquo;d Issue&rdquo; tells RX95 to look for an existing Buganizer bug in this plan&rsquo;s hotlist (shown in ② Ready to file).
                                </p>
                              )}
                            </div>

                            {/* Evidence photo + Filed */}
                            <div className="space-y-3">
                              <div>
                                <label className={labelCls}>Photo</label>
                                {hasPhoto ? (
                                  <div
                                    data-testid="feed-photo"
                                    onClick={() => setSelectedImagePreviewUrl(bug.imageUrl!)}
                                    className="relative group rounded-xl overflow-hidden border border-slate-700 cursor-pointer bg-slate-900 max-h-32 flex items-center justify-center"
                                    title="Click for full image"
                                  >
                                    <img
                                      src={bug.imageUrl}
                                      alt="Bug screenshot"
                                      className="w-full object-cover max-h-32"
                                    />
                                    <div className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                                      <span className="px-2.5 py-1 bg-slate-900/95 text-slate-100 border border-slate-600 rounded-xl text-[11px] font-semibold flex items-center gap-1.5">
                                        <ImageIcon className="w-3.5 h-3.5 text-blue-400" /> Full image
                                      </span>
                                    </div>
                                  </div>
                                ) : (
                                  <p data-testid="feed-no-photo" className="text-[11px] text-slate-500">
                                    No photo
                                  </p>
                                )}
                              </div>
                              {(() => {
                                // Filed stamp: from the stored bug (a legacy stored status 'Filed' counts as filed)
                                const rawBug = bugById.get(bug.id) || bug;
                                const filed = effectiveFiled(rawBug);
                                const canEdit = !!(onPatchBugLog || onUpdateBugLog);
                                const setFiled = (next: ReturnType<typeof effectiveFiled>) => {
                                  const patch = {
                                    ...filedPatch(rawBug, next),
                                    reviewed: reviewedNow('reviewed')
                                  };
                                  if (onPatchBugLog) onPatchBugLog(bug.id, patch);
                                  else if (onUpdateBugLog) onUpdateBugLog({ ...rawBug, ...patch });
                                };
                                const draftId = filedIssueDrafts[bug.id] ?? '';
                                const normalizedDraftId = normalizeIssueId(draftId);
                                const isReprod =
                                  effectiveStatus(
                                    bugCategorizations[bug.id]?.status || rawBug.status
                                  ) === REPROD;
                                // RX95's likely existing bugs, offered as one-click picks for the b/ field
                                const followUpPicks = isReprod
                                  ? (currentReproMatches(rawBug as BugLog)?.candidates || [])
                                      .filter(c => c.verdict !== 'unlikely')
                                      .slice(0, 3)
                                  : [];
                                return (
                                  <div
                                    data-testid="feed-filed"
                                    className={`rounded-2xl border p-3 ${
                                      filed
                                        ? 'border-green-500/40 bg-green-500/[0.05]'
                                        : 'border-slate-800 bg-[#111827]'
                                    }`}
                                  >
                                    {filed && (
                                      <div
                                        data-testid="feed-filed-stamp"
                                        className="mb-2.5 border-4 border-green-500 text-green-500 rounded-[14px] py-2.5 text-center font-black text-[28px] tracking-[0.25em] -rotate-3 bg-green-500/[0.08] shadow-[0_0_30px_rgba(34,197,94,0.25)] select-none"
                                      >
                                        FILED
                                        {filedStampLine(filed) && (
                                          <small className="block text-[11px] tracking-normal font-bold text-green-300 mt-0.5">
                                            {filedStampLine(filed)}
                                          </small>
                                        )}
                                      </div>
                                    )}
                                    {/* Not a <label>: a label would re-dispatch the click to the switch and toggle it twice */}
                                    <div
                                      className={`flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-200 ${
                                        canEdit ? '' : 'opacity-60'
                                      }`}
                                    >
                                      <button
                                        type="button"
                                        role="switch"
                                        aria-checked={!!filed}
                                        data-testid="feed-filed-toggle"
                                        disabled={!canEdit}
                                        onClick={() => {
                                          if (filed) setFiled(undefined);
                                          else {
                                            // A b/ on a Repro'd bug is the existing bug it was followed up on (summary: "(KI, updated)")
                                            setFiled(
                                              newFiled(
                                                isReprod && normalizedDraftId
                                                  ? 'follow-up'
                                                  : 'manual',
                                                normalizedDraftId
                                              )
                                            );
                                            setFiledIssueDrafts(prev => {
                                              const n = { ...prev };
                                              delete n[bug.id];
                                              return n;
                                            });
                                          }
                                        }}
                                        className={`relative w-10 h-[22px] rounded-full transition flex-shrink-0 ${
                                          filed ? 'bg-green-500' : 'bg-slate-700'
                                        }`}
                                      >
                                        <span
                                          className={`absolute top-[3px] w-4 h-4 rounded-full bg-white transition-all ${
                                            filed ? 'right-[3px]' : 'left-[3px]'
                                          }`}
                                        />
                                      </button>
                                      {filed ? (
                                        <>
                                          Filed{' '}
                                          <span className="text-[11px] font-medium text-slate-400">
                                            (moves to ③ Filed)
                                          </span>
                                        </>
                                      ) : (
                                        'Mark as filed'
                                      )}
                                      {!filed && canEdit && (
                                        <input
                                          data-testid="feed-filed-issue"
                                          aria-label="Filed b/ issue number"
                                          value={draftId}
                                          inputMode="numeric"
                                          onChange={e =>
                                            setFiledIssueDrafts(prev => ({
                                              ...prev,
                                              [bug.id]: e.target.value
                                            }))
                                          }
                                          onBlur={e =>
                                            setFiledIssueDrafts(prev => ({
                                              ...prev,
                                              [bug.id]: normalizeIssueId(e.target.value)
                                            }))
                                          }
                                          placeholder={
                                            isReprod ? 'b/ followed up on' : 'b/ (optional)'
                                          }
                                          className="ml-auto w-36 bg-[#0f172a] border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100 font-mono font-normal focus:outline-none focus:border-green-500"
                                        />
                                      )}
                                    </div>
                                    {!filed && canEdit && isReprod && followUpPicks.length > 0 && (
                                      <div
                                        data-testid="feed-filed-picks"
                                        className="mt-1.5 flex flex-wrap gap-1.5 items-center"
                                      >
                                        <span className="text-[10px] text-slate-400">
                                          Followed up on:
                                        </span>
                                        {followUpPicks.map(c => (
                                          <button
                                            key={c.id}
                                            type="button"
                                            data-testid="feed-filed-pick"
                                            title={c.title}
                                            onClick={() =>
                                              setFiledIssueDrafts(prev => ({
                                                ...prev,
                                                [bug.id]: normalizeIssueId(String(c.id))
                                              }))
                                            }
                                            className={`max-w-full truncate text-[10px] px-2 py-0.5 rounded-full border font-mono ${
                                              normalizedDraftId === String(c.id)
                                                ? 'border-green-500 bg-green-500/15 text-green-200'
                                                : 'border-slate-600 bg-slate-800 text-slate-200 hover:border-green-500/60'
                                            }`}
                                          >
                                            b/{c.id} ·{' '}
                                            {(c.title || '')
                                              .replace(/^(\[[^\]]*\]\s*)+/, '')
                                              .slice(0, 48)}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          };

          return (
            <>
              <div className={listBoxCls} data-testid="feed-list">
                {feedRows.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-400">
                    {processedBugs.length
                      ? 'Nothing new - every report here has been reviewed.'
                      : 'No matching bugs for these filters.'}
                  </div>
                ) : (
                  groupedSections.map(sec => {
                    const isLongGroup = feedGroupBy !== 'time' && sec.rows.length > 3;
                    const isGroupExpanded = !!expandedGroups[sec.key];
                    const shownRows = isLongGroup && !isGroupExpanded ? sec.rows.slice(0, 3) : sec.rows;
                    const hiddenCount = sec.rows.length - shownRows.length;
                    return (
                      <div key={sec.key} data-testid="feed-group" data-group-key={sec.key}>
                        <div
                          data-testid="feed-group-header"
                          className="px-3.5 py-2 bg-[#0b1120] border-b border-slate-800/80 flex items-center justify-between text-[10.5px] font-bold tracking-wider uppercase text-slate-400"
                        >
                          <span>
                            <span className="text-slate-200">{sec.label}</span>{' '}
                            <span className="text-slate-500">· {sec.count}</span>
                          </span>
                          {sec.rightMeta && (
                            <span className="font-normal normal-case tracking-normal text-[11px] text-slate-400">
                              {sec.rightMeta}
                            </span>
                          )}
                        </div>
                        {shownRows.map(row =>
                          row.kind === 'suggestion'
                            ? renderInlineSuggestion(row, renderFeedBug)
                            : row.kind === 'bundle'
                            ? renderFeedBundle(row, renderFeedBug)
                            : renderFeedBug(row.bug)
                        )}
                        {isLongGroup && (
                          <div className="px-3.5 py-2 bg-[#0b1120]/60 border-b border-slate-800/80 text-[11px] text-slate-400">
                            {hiddenCount > 0 ? (
                              <>
                                <span>+{hiddenCount} more · </span>
                                <button
                                  type="button"
                                  data-testid="feed-group-show-all"
                                  onClick={() =>
                                    setExpandedGroups(prev => ({ ...prev, [sec.key]: true }))
                                  }
                                  className="text-blue-400 hover:text-blue-300 font-semibold cursor-pointer"
                                >
                                  show all
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                data-testid="feed-group-collapse"
                                onClick={() =>
                                  setExpandedGroups(prev => ({ ...prev, [sec.key]: false }))
                                }
                                className="text-slate-400 hover:text-slate-200 font-semibold cursor-pointer"
                              >
                                show less
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
              {feedRows.length > 0 && (
                <p
                  data-testid="feed-keyboard-hint"
                  className="text-[11px] text-slate-500 px-1"
                >
                  Keyboard: <b className="text-slate-400">J/K</b> next/previous ·{' '}
                  <b className="text-slate-400">Enter</b> expand ·{' '}
                  <b className="text-slate-400">R</b> mark reviewed ·{' '}
                  <b className="text-slate-400">1/2/3</b> set P0/P1/P2
                </p>
              )}
            </>
          );
        })()}

      {feedToast && (
        <div
          data-testid="feed-toast"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-2xl bg-slate-800 border border-slate-600 text-xs text-slate-100 shadow-2xl"
        >
          {feedToast}
        </div>
      )}
    </div>
  );
};
