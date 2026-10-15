import React, { useEffect, useMemo, useState } from 'react';
import { Bug, CheckCircle2, Copy, ExternalLink, Eye, Filter, Search, ShieldCheck, X } from 'lucide-react';
import type { BugLog, TestPlan } from '../types';
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
  loadDrafts,
  syncDraftWithBug,
  saveDrafts,
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
}

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

export default function BuganizerTriage({ bugs, plans }: Props) {
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

  const ctxFor = (bug: BugLog) => ({ planId: bug.planId, planName: planName(bug.planId), cujName: bug.feature || 'General' });
  const draftFromStore = (store: Record<string, BuganizerDraft>, bug: BugLog): BuganizerDraft =>
    store[bug.id] ? syncDraftWithBug(store[bug.id], bug, ctxFor(bug)) : buildDefaultDraft(bug, ctxFor(bug));
  const draftFor = (bug: BugLog): BuganizerDraft => draftFromStore(drafts, bug);

  const updateDraft = (bug: BugLog, patch: Partial<BuganizerDraft>) =>
    setDrafts(prev => ({ ...prev, [bug.id]: { ...draftFromStore(prev, bug), ...patch, updatedAt: Date.now() } }));

  const testers = useMemo(() => Array.from(new Set(bugs.map(b => (b.testerName || '').trim()).filter(Boolean))).sort(), [bugs]);
  const cujs = useMemo(() => Array.from(new Set(bugs.map(b => b.feature || 'General'))).sort(), [bugs]);
  const planIds = useMemo(() => Array.from(new Set(bugs.map(b => b.planId).filter(Boolean))), [bugs]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bugs
      .filter(b => (b.note || '').trim())
      .filter(b => tester === 'all' || (b.testerName || '').trim().toLowerCase() === tester.toLowerCase())
      .filter(b => planId === 'all' || b.planId === planId)
      .filter(b => !day || localDay(b.timestamp) === day)
      .filter(b => cuj === 'all' || (b.feature || 'General') === cuj)
      .filter(b => stateFilter === 'all' || draftFor(b).state === stateFilter)
      .filter(b => !q || `${b.note} ${b.stepTitle} ${draftFor(b).title}`.toLowerCase().includes(q))
      .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bugs, tester, planId, day, cuj, stateFilter, query, drafts]);

  const counts = useMemo(() => {
    const c: Record<DraftState, number> = { draft: 0, ready: 0, opened: 0, filed: 0 };
    visible.forEach(b => { c[draftFor(b).state]++; });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, drafts]);

  const selectedVisible = visible.filter(b => selected.has(b.id));
  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4000); };

  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAllReady = () => setSelected(new Set(visible.filter(b => draftFor(b).state === 'ready').map(b => b.id)));
  const markSelected = (state: DraftState) => {
    selectedVisible.forEach(b => updateDraft(b, { state }));
    flash(`${selectedVisible.length} bug${selectedVisible.length === 1 ? '' : 's'} marked ${STATE_LABEL[state]}.`);
  };

  const startOpen = () => {
    const list = selectedVisible.map(draftFor);
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
      return next;
    });
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
        <span className="text-xs text-slate-300 font-semibold mr-1">{selectedVisible.length} selected</span>
        <button className="px-2.5 h-7 rounded-xl text-xs text-slate-200 hover:bg-slate-800" onClick={() => setSelected(new Set(visible.map(b => b.id)))}>Select all</button>
        <button className="px-2.5 h-7 rounded-xl text-xs text-slate-200 hover:bg-slate-800" onClick={selectAllReady}>Select ready</button>
        <button className="px-2.5 h-7 rounded-xl text-xs text-slate-200 hover:bg-slate-800" onClick={() => setSelected(new Set())}>Clear</button>
        <span className="w-px h-5 bg-slate-700 mx-1" />
        <button className="px-2.5 h-7 rounded-xl text-xs text-blue-200 hover:bg-blue-600/20" onClick={() => markSelected('ready')}>Mark ready</button>
        <button className="px-2.5 h-7 rounded-xl text-xs text-slate-300 hover:bg-slate-800" onClick={() => markSelected('draft')}>Back to draft</button>
        <div className="flex-1" />
        {openQueue.length > 0 && (
          <button data-testid="open-remaining" className="px-3 h-8 rounded-xl text-xs font-semibold bg-amber-500/20 text-amber-100 border border-amber-500/40" onClick={openRemaining}>
            Open remaining ({openQueue.length})
          </button>
        )}
        <button
          data-testid="open-in-buganizer"
          disabled={selectedVisible.length === 0}
          onClick={startOpen}
          className="px-3 h-8 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ExternalLink className="w-3.5 h-3.5" /> Open {selectedVisible.length || ''} in Buganizer
        </button>
      </div>

      {/* Bug list */}
      <div className="space-y-3">
        {visible.length === 0 && (
          <div className="rounded-[20px] border border-slate-800 bg-[#111827] p-8 text-center text-sm text-slate-400">No bugs match these filters.</div>
        )}
        {visible.map(bug => {
          const d = draftFor(bug);
          const url = buildBuganizerUrl(d);
          const comp = componentById(d.componentId);
          const isOpen = expanded === bug.id;
          return (
            <div key={bug.id} data-testid="triage-row" className={`rounded-[20px] border bg-[#111827] p-4 ${selected.has(bug.id) ? 'border-blue-500/60 ring-1 ring-blue-500/30' : 'border-slate-800'}`}>
              <div className="flex items-start gap-3">
                <input type="checkbox" aria-label={`Select ${bug.id}`} className="mt-1 accent-blue-500" checked={selected.has(bug.id)} onChange={() => toggle(bug.id)} />
                <div className="flex-1 min-w-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-4">
                  {/* Original tester note */}
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className={`px-2 py-0.5 rounded-full border ${STATE_STYLE[d.state]}`}>{STATE_LABEL[d.state]}{d.state === 'filed' && d.issueId ? ` · b/${d.issueId}` : ''}</span>
                      <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">{bug.feature || 'General'}</span>
                    </div>
                    {bug.title && <p className="text-sm font-semibold text-white leading-snug">{bug.title}</p>}
                    {(!bug.title || bug.note !== bug.title) && (
                      <p className={`${bug.title ? 'text-xs text-slate-300 line-clamp-3 whitespace-pre-line' : 'text-sm text-slate-100'} leading-snug`}>{bug.note}</p>
                    )}
                    <p className="text-[11px] text-slate-400">
                      {bug.testerName || 'Unknown'} · {bug.deviceName || 'Unknown device'} · {bug.formattedTime || localDay(bug.timestamp)}
                    </p>
                    <p className="text-[11px] text-slate-500 truncate">{planName(bug.planId)} › {bug.stepTitle}</p>
                  </div>

                  {/* Buganizer fields */}
                  <div className="space-y-2">
                    <div>
                      <label className={labelCls}>Title</label>
                      <input aria-label="Title" className={inputCls} value={d.title} onChange={e => updateDraft(bug, { title: e.target.value })} />
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <div className="col-span-2">
                        <label className={labelCls}>Component</label>
                        <select aria-label="Component" className={inputCls} value={d.componentId} onChange={e => updateDraft(bug, { componentId: e.target.value })}>
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
                        <select aria-label="Priority" className={inputCls} value={d.priority} onChange={e => updateDraft(bug, { priority: e.target.value })}>
                          {BUGANIZER_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Type</label>
                        <select aria-label="Type" className={inputCls} value={d.type} onChange={e => updateDraft(bug, { type: e.target.value })}>
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
                              title={hotlistForPlan(bug.planId, planName(bug.planId)) ? `Auto-set from test plan: ${hotlistForPlan(bug.planId, planName(bug.planId))!.name}` : 'No hotlist mapped to this test plan'}
                              onChange={e => updateDraft(bug, { hotlistIds: e.target.value ? [e.target.value] : [] })}>
                              <option value="">None</option>
                              {KNOWN_HOTLISTS.map(h => <option key={h.hotlistId} value={h.hotlistId}>{h.name} · {h.hotlistId}</option>)}
                              {cur && !known && <option value={cur}>Custom · {cur}</option>}
                            </select>
                          );
                        })()}
                      </div>
                      <div>
                        <label className={labelCls}>Assignee</label>
                        <input aria-label="Assignee" className={inputCls} value={d.assignee} placeholder="ldap" onChange={e => updateDraft(bug, { assignee: e.target.value })} />
                      </div>
                      <div>
                        <label className={labelCls}>CC</label>
                        <input aria-label="CC" className={inputCls} value={d.cc} placeholder="ldap1, team@google.com" onChange={e => updateDraft(bug, { cc: e.target.value })} />
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>Found in</label>
                      <input aria-label="Found in" className={inputCls} value={d.foundIn || ''} placeholder="Glasses firmware build (scanned in QA Tester)"
                        onChange={e => updateDraft(bug, { foundIn: e.target.value })} />
                    </div>
                    {isOpen && (
                      <div>
                        <label className={labelCls}>Description (Markdown)</label>
                        <textarea aria-label="Description" rows={9} className={`${inputCls} font-mono leading-relaxed`} value={d.description} onChange={e => updateDraft(bug, { description: e.target.value })} />
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button className="px-2.5 h-7 rounded-xl text-xs text-slate-300 hover:bg-slate-800" onClick={() => setExpanded(isOpen ? null : bug.id)}>
                        {isOpen ? 'Hide description' : 'Edit description'}
                      </button>
                      {d.state === 'draft' && (
                        <button className="px-2.5 h-7 rounded-xl text-xs font-semibold bg-blue-600/20 text-blue-200 border border-blue-500/40" onClick={() => updateDraft(bug, { state: 'ready' })}>
                          <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" />Ready to file
                        </button>
                      )}
                      {d.state !== 'draft' && d.state !== 'filed' && (
                        <button className="px-2.5 h-7 rounded-xl text-xs text-slate-300 hover:bg-slate-800" onClick={() => updateDraft(bug, { state: 'draft' })}>Back to draft</button>
                      )}
                      <button className="px-2.5 h-7 rounded-xl text-xs text-slate-300 hover:bg-slate-800" onClick={() => { setAllowOpen(false); setPreviewExpanded(new Set([d.bugId])); setPreview([d]); }}>
                        <Eye className="w-3.5 h-3.5 inline mr-1" />Preview
                      </button>
                      <div className="flex items-center gap-1 ml-auto">
                        <span className="text-[11px] text-slate-400">Filed as b/</span>
                        <input aria-label="Filed issue id" className="w-28 bg-[#0f172a] border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100" value={d.issueId || ''} placeholder="573…"
                          onChange={e => { const id = e.target.value.replace(/[^\d]/g, ''); updateDraft(bug, { issueId: id || undefined, state: id ? 'filed' : (d.state === 'filed' ? 'opened' : d.state) }); }} />
                      </div>
                    </div>
                    {url.length > MAX_SAFE_URL_LENGTH && (
                      <p className="text-[11px] text-amber-300">This link is very long ({url.length} chars). Shorten the description so the form opens reliably.</p>
                    )}
                  </div>
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
