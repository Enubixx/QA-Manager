import React from 'react';
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
import BundleSuggestionsPanel, { type GroupCategory } from '../BundleSuggestionsPanel';
import type { ShownSuggestion } from '../../utils/bundleDraft';
import type { Rx95SuggestionsData } from '../../services/supabaseService';

export type FeedDraft = { title: string; note: string; time: string };

export type BugCategorizationMap = Record<
  string,
  {
    bugType?: 'Bug' | 'Setup Issue' | 'Known Issue' | 'Feature Request' | 'Misc Issue';
    priority?: 'P0' | 'P1' | 'P2';
    status?: 'Filed' | 'New' | "Repro'd Issue";
  }
>;

export type FeedRow = { kind: 'bug'; bug: BugLog } | { kind: 'bundle'; id: string; members: BugLog[] };

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
  sortByDevice: 'newest' | 'oldest' | 'device-asc' | 'device-desc' | 'priority' | 'severity';
  setSortByDevice: React.Dispatch<
    React.SetStateAction<'newest' | 'oldest' | 'device-asc' | 'device-desc' | 'priority' | 'severity'>
  >;
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
  setSortByDevice
}) => {
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
          <span
            className={`font-mono text-[10px] px-2.5 py-0.5 rounded-full border font-bold uppercase ${
              pri === 'P0' || pri === '0'
                ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                : pri === 'P1' || pri === '1'
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-slate-800 text-slate-300 border-slate-700'
            }`}
          >
            {pri}
          </span>
          <span className="font-mono text-[10px] px-2.5 py-0.5 rounded-full border border-slate-700 bg-slate-800 text-slate-300">
            {bugTypeLabel}
          </span>
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
              ⏳ WAITING
            </span>
          )}
          <span className="text-xs text-slate-400">
            {testersN} tester{testersN === 1 ? '' : 's'}
            {row.members.length < total ? ` · ${row.members.length} shown` : ''}
          </span>
          <button type="button" className={rowActionCls}>
            {open ? 'Close' : 'Open'}
          </button>
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

  return (
    <>
      {/* Bugs Feed / Buganizer toggle (hidden only when VITE_BUGANIZER_ENABLED=0) */}
      {buganizerEnabled && (
        <div className="inline-flex items-center bg-[#0f172a] border border-slate-800 rounded-2xl p-0.5 gap-0.5 h-8">
          <button
            type="button"
            onClick={() => setBugsView('feed')}
            className={`px-3 h-7 rounded-xl text-xs font-semibold ${
              bugsView === 'feed' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            Bugs Feed
          </button>
          <button
            type="button"
            data-testid="buganizer-tab"
            onClick={() => setBugsView('buganizer')}
            className={`px-3 h-7 rounded-xl text-xs font-semibold ${
              bugsView === 'buganizer' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            Buganizer
          </button>
        </div>
      )}
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
          />
        </div>
      )}

      {/* Tab 3: Bugs Feed (Layout B look: status chips + plan/day/search, tabs New / Bundle Suggestions / Reviewed, one-line rows) */}
      {(!buganizerEnabled || bugsView === 'feed') &&
        (() => {
          const fmtT = (iso?: string) => {
            const d = new Date(iso || '');
            return Number.isNaN(d.getTime())
              ? ''
              : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          };
          const renderFeedBug = (bug: BugLog) => {
            const isBugExpanded = !!expandedBugIds[bug.id];
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
            const sg = suggestionByBugId.get(bug.id);
            return (
              <div key={bug.id} id={`feed-row-${bug.id}`}>
                <div
                  data-testid="feed-row"
                  data-bug-id={bug.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleBugExpand(bug.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') toggleBugExpand(bug.id);
                  }}
                  className={`${rowCls} ${isBugExpanded ? rowOpenCls : ''}`}
                >
                  <span className="text-[10.5px] text-slate-400 w-[58px] whitespace-nowrap">
                    {fmtT(bug.timestamp)}
                  </span>
                  <span className="hidden md:inline text-[11.5px] text-slate-400 truncate max-w-[150px]">
                    {bug.testerName || 'Unknown'} · {bug.deviceName || '?'}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-slate-100" title={bug.note}>
                    {rowTitle}
                  </span>
                  {bug.imageUrl && /^(data:image\/|https?:\/\/|blob:|\/)/i.test(bug.imageUrl) && (
                    <ImageIcon className="w-3.5 h-3.5 text-blue-300 flex-shrink-0" />
                  )}
                  <span className="hidden lg:inline text-[11.5px] text-slate-400 truncate max-w-[170px]">
                    {bug.feature || 'General'}
                  </span>
                  <span className={`${tagCls} ${TAG_STYLE.new}`}>{bug.bugType || 'Bug'}</span>
                  <span className={priTagCls(String(bug.priority || 'P2'))}>
                    {bug.priority || 'P2'}
                  </span>
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
                      {raw.filePending!.expired ? '⚠ NOT FOUND' : '⏳ WAITING'}
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
                  {sg && (
                    <button
                      type="button"
                      data-testid="feed-dupe-chip"
                      onClick={e => {
                        e.stopPropagation();
                        jumpToSuggestion(sg.suggestion.id);
                      }}
                      className={`${tagCls} border border-violet-500/50 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20`}
                      title="RX95 thinks this is the same issue as other reports - review it in Bundle Suggestions"
                    >
                      🧩 dupe of {sg.members.length - 1}
                    </button>
                  )}
                  <button
                    type="button"
                    className={rowActionCls}
                    onClick={e => {
                      e.stopPropagation();
                      toggleBugExpand(bug.id);
                    }}
                  >
                    {isBugExpanded ? 'Close' : 'Open'}
                  </button>
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
                                    flashFeed('Marked reviewed.');
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
                                Open in Buganizer tab ↗
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
                                      Unsaved changes · save to carry over to the Buganizer tab.
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
                                  💡 "Repro'd Issue" tells RX95 to look for an existing Buganizer bug in this plan's hotlist (shown on the Buganizer tab).
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
                                            (hidden from the Buganizer tab)
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

          const dayValue = selectedDateFilter === 'custom' ? customDateInput : '';
          const moreActive =
            selectedFeatureFilter !== 'all' ||
            selectedDeviceFilter !== 'all' ||
            sortByDevice !== 'newest' ||
            (selectedDateFilter !== 'all' && selectedDateFilter !== 'custom');
          const feedTabs = [
            { key: 'new' as const, label: 'New', count: newFeedBugs.length, testid: 'feed-tab-new' },
            {
              key: 'suggestions' as const,
              label: 'Bundle Suggestions',
              count: feedSuggestions.length,
              testid: 'feed-tab-suggestions'
            },
            {
              key: 'reviewed' as const,
              label: 'Reviewed',
              count: reviewedFeedBugs.length,
              testid: 'feed-tab-reviewed'
            }
          ];
          return (
            <div className="space-y-4" data-testid="bugs-feed">
              {/* Header: status chips + plan / day / search (same look as the Buganizer tab) */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap items-center gap-2" data-testid="feed-status-chips">
                  <Rx95LiveChip
                    heartbeatAt={rx95Suggestions?.heartbeat?.at}
                    nowMs={feedNow}
                    jobsInProgress={
                      (rx95Suggestions?.heartbeat?.queues?.refine || 0) +
                      (rx95Suggestions?.heartbeat?.queues?.match || 0) +
                      (rx95Suggestions?.heartbeat?.queues?.bundle || 0)
                    }
                    testid="feed-rx95-chip"
                  />
                  <button
                    type="button"
                    data-testid="feed-chip-new"
                    className={`${chipCls} ${feedTab === 'new' ? chipOn : chipOff}`}
                    onClick={() => setFeedTab('new')}
                  >
                    🆕 <b className="text-white">{newFeedBugs.length}</b> new
                  </button>
                  <button
                    type="button"
                    data-testid="feed-chip-suggestions"
                    className={`${chipCls} ${feedTab === 'suggestions' ? chipOn : chipOff}`}
                    onClick={() => setFeedTab('suggestions')}
                  >
                    🧩 <b className="text-white">{feedSuggestions.length}</b> suggestion
                    {feedSuggestions.length === 1 ? '' : 's'}
                  </button>
                  <button
                    type="button"
                    data-testid="feed-chip-reviewed"
                    className={`${chipCls} ${feedTab === 'reviewed' ? chipOn : chipOff}`}
                    onClick={() => setFeedTab('reviewed')}
                  >
                    ✓ <b className="text-white">{reviewedFeedBugs.length}</b> reviewed
                  </button>
                </div>
                <div className="flex-1" />
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

              <TabBar tabs={feedTabs} active={feedTab} onChange={setFeedTab} testid="feed-tabs" />

              {feedTab === 'suggestions' ? (
                feedSuggestions.length === 0 ? (
                  <div className={`${listBoxCls} p-8 text-center text-sm text-slate-400`}>
                    No bundle suggestions for these filters. RX95 suggests them as same-day duplicates come in.
                  </div>
                ) : (
                  <BundleSuggestionsPanel
                    shown={feedSuggestions}
                    bugsById={processedBugById}
                    plans={testPlans}
                    dismissed={dismissedSuggestions}
                    onDismissedChange={setDismissedSuggestions}
                    onApply={handleCategorizeAndBundle}
                    collapsed={suggestionsCollapsed}
                    onCollapsedChange={setSuggestionsCollapsed}
                  />
                )
              ) : (
                <div className={listBoxCls} data-testid="feed-list">
                  {feedRows.length === 0 ? (
                    <div className="p-8 text-center text-sm text-slate-400">
                      {feedTab === 'new'
                        ? processedBugs.length
                          ? 'Nothing new - every report here has been reviewed.'
                          : 'No matching bugs for these filters.'
                        : 'No reviewed reports for these filters yet.'}
                    </div>
                  ) : (
                    feedRows.map(row =>
                      row.kind === 'bundle'
                        ? renderFeedBundle(row, renderFeedBug)
                        : renderFeedBug(row.bug)
                    )
                  )}
                </div>
              )}
            </div>
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
    </>
  );
};
