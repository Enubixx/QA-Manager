import React from 'react';

/**
 * Shared look for the Bugs Feed and the Buganizer tab (Layout B): status chips, tab bar, one-line rows
 * that expand in place. Keep both tabs on these classes so they look and behave the same.
 */
export const chipCls = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] border whitespace-nowrap';
export const chipOff = 'border-slate-700 bg-[#141c2f] text-slate-300 hover:border-slate-500';
export const chipOn = 'border-blue-500/70 bg-blue-500/15 text-white';

/** Row tags (kind of item). */
export const TAG_STYLE = {
  new: 'bg-slate-800 text-slate-300',
  repro: 'bg-violet-500/20 text-violet-200',
  bundle: 'bg-blue-500/20 text-blue-200',
  waiting: 'bg-amber-500/15 text-amber-200',
  filed: 'bg-green-500/15 text-green-300',
  expired: 'bg-rose-500/15 text-rose-200',
} as const;
export const tagCls = 'text-[10.5px] rounded-md px-1.5 py-0.5 font-semibold whitespace-nowrap';
export const priTagCls = (p?: string) =>
  `${tagCls} ${p === 'P0' || p === '0' ? 'bg-rose-500/20 text-rose-300' : p === 'P1' || p === '1' ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-slate-300'}`;

/** The list box and its one-line rows. */
export const listBoxCls = 'rounded-[20px] border border-slate-800 bg-[#0f172a] overflow-hidden';
export const rowCls = 'flex items-center gap-2.5 px-3 py-2 border-b border-slate-800/80 text-[12.5px] cursor-pointer hover:bg-[#111a2c]';
export const rowOpenCls = 'bg-[#111a2c]';
export const expandedCls = 'p-3 bg-[#0b1220] border-b border-slate-800';
export const rowActionCls = 'text-[11.5px] font-bold rounded-lg px-2.5 py-1 border border-slate-700 bg-[#141c2f] text-slate-200 hover:border-slate-500 whitespace-nowrap';
export const smallBtnCls = 'px-2.5 h-7 rounded-xl text-xs font-semibold border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700';

export interface TabDef<K extends string> { key: K; label: string; count: number; testid?: string }

/** Tab bar with counts (Buganizer B style). */
export function TabBar<K extends string>({ tabs, active, onChange, testid }: {
  tabs: TabDef<K>[];
  active: K;
  onChange: (k: K) => void;
  testid?: string;
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-slate-800" role="tablist" data-testid={testid}>
      {tabs.map(t => (
        <button key={t.key} type="button" role="tab" aria-selected={active === t.key} data-testid={t.testid}
          className={`px-3 py-2 text-[12.5px] border-b-2 -mb-px ${active === t.key ? 'text-white border-blue-500 font-bold' : 'text-slate-400 border-transparent hover:text-slate-200'}`}
          onClick={() => onChange(t.key)}>
          {t.label}<span className="ml-1.5 text-[11px] bg-slate-800 rounded-full px-1.5 text-slate-300">{t.count}</span>
        </button>
      ))}
    </div>
  );
}

/** "RX95 live · synced Ns ago" (or error) from the worker heartbeat; hidden when offline without error.
 *  `stalled`: the worker runs but RX95 stopped answering it -> amber "not responding" chip. */
export function Rx95LiveChip({ heartbeatAt, nowMs, jobsInProgress = 0, offlineText = 'offline', error = false, stalled = false, title, onClick, testid }: {
  heartbeatAt?: string;
  nowMs: number;
  jobsInProgress?: number;
  offlineText?: string;
  error?: boolean;
  stalled?: boolean;
  title?: string;
  onClick?: () => void;
  testid?: string;
}) {
  const age = heartbeatAt ? Math.max(0, (nowMs - new Date(heartbeatAt).getTime()) / 1000) : Infinity;
  const live = Number.isFinite(age) && age < 90;
  if (!live && !error) return null;
  if (live && stalled) {
    return (
      <button type="button" data-testid={testid} data-stalled="true" onClick={onClick}
        className={`${chipCls} border-amber-500/60 text-amber-200 bg-amber-500/10`}
        title="RX95 isn't answering the background helper. Wording cleanup and bundle suggestions are paused until it does; it retries on its own.">
        <span className="w-[7px] h-[7px] rounded-full bg-amber-400" />
        <b className="text-white">RX95 not responding</b> · suggestions paused
      </button>
    );
  }
  return (
    <button type="button" data-testid={testid} onClick={onClick}
      className={`${chipCls} ${!live && error ? 'border-amber-500/60 text-amber-200 bg-amber-500/10' : chipOff}`}
      title={title ?? (live ? 'RX95 is working in the background' : "RX95's background helper is offline")}>
      <span className={`w-[7px] h-[7px] rounded-full ${live ? 'bg-green-500 shadow-[0_0_6px_#22c55e]' : 'bg-amber-400'}`} />
      <b className="text-white">{live ? 'RX95 live' : 'RX95'}</b> · {live ? `synced ${Math.round(age)}s ago${jobsInProgress ? ` · ${jobsInProgress} in progress` : ''}` : offlineText}
    </button>
  );
}

/** Small "not reviewed yet" dot. */
export const UnreviewedDot = ({ title = 'Not reviewed on the Bugs Feed yet' }: { title?: string }) => (
  <span data-testid="unreviewed-dot" title={title} className="w-2 h-2 rounded-full bg-sky-400 shadow-[0_0_6px_#38bdf8] flex-shrink-0" />
);

export const stopProp = (e: React.SyntheticEvent) => e.stopPropagation();

/** Inputs / selects in the header and editors. */
export const inputCls = 'w-full bg-[#0f172a] border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500';
/** Small uppercase field label (same as the Buganizer tab's form labels). */
export const labelCls = 'block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1';
