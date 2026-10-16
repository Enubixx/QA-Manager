/**
 * RX95 background worker (runs inside the RX95 bridge on the Cloudtop, supabase mode only).
 *
 * Watches bug reports and does RX95's work as they arrive, instead of waiting for someone to open
 * the Buganizer tab:
 *   refine   clean up the wording of new / edited reports (batches of <= 25)
 *   match    repro check for "Repro'd Issue" reports (one at a time)
 *   bundle   same-day bundle suggestions per plan + day (table rx95_bundle_suggestions)
 *   confirm  "Waiting for Buganizer" -> FILED once Buganizer shows proof (read-only CLI), 24h expiry
 *   heartbeat row '_heartbeat' every 30 s for the app's green status bar
 *
 * Triggers: Supabase realtime postgres_changes on bug_logs / test_runs / archived_runs (or an SSE
 * feed from the dev mock), coalesced for ~3 s, plus a 60 s safety sweep.
 *
 * Safety: it only ever writes its own columns (refined, repro_matches, filed, file_pending) on
 * bug_logs, its own table rx95_bundle_suggestions, and minimal bug_logs rows for reports that only
 * exist inside run JSON (never the runs themselves). Every RX95 result is re-checked against a
 * fresh read (bugTextSig) right before writing, so edits made meanwhile win. Missing columns /
 * tables are detected once and only the affected job is skipped.
 */
import { createClient } from '@supabase/supabase-js';
import type { BugBundle, BugFilePending, BugFiled, BugLog, BundleSuggestion, BundleSuggestionSet, RefinedBugText, ReproMatches } from '../../src/types';
import { REFINE_MAX_BUGS_PER_REQUEST, bugTextSig, parseRefineReply, toRefineInput, type RefineBugInput } from '../../src/utils/bugRefine';
import { bundleGroupSig, laDay, parseBundleReply, splitForPrompt, toBundleInput, type BundleReportInput } from '../../src/utils/bundleMatch';
import { parseMatchReply, toMatchInput, type MatchBugInput } from '../../src/utils/reproMatch';

const WORKER_VERSION = 'w1';
const DAY_MS = 86_400_000;
const WATCH_DAYS = 7;
const COALESCE_MS = Number(process.env.RX95_WORKER_COALESCE_MS || 3000);
const SWEEP_MS = Number(process.env.RX95_WORKER_SWEEP_MS || 60_000);
const HEARTBEAT_MS = Number(process.env.RX95_WORKER_HEARTBEAT_MS || 30_000);
const CONFIRM_EVERY_MS = Number(process.env.RX95_WORKER_CONFIRM_MS || 60_000);
const CONFIRM_WINDOW_MS = DAY_MS;
const CONFIRM_MAX_CLI_PER_TICK = 15;
const BUNDLE_WAIT_FOR_REFINE_MS = 3 * 60_000;
const REPROD = "Repro'd Issue";
const BUG_ID = /^bug-\d{6,16}-[a-z0-9]{2,12}$/i;
const SUGGESTIONS = 'rx95_bundle_suggestions';

/** Everything the worker needs from the bridge (real RX95 + issues CLI, or fakes in dev). */
export interface WorkerPorts {
  log: (...m: unknown[]) => void;
  allow: (kind: 'refine' | 'match' | 'bundle') => boolean;
  refine: (bugs: RefineBugInput[]) => Promise<string>;
  /** Reply with the verified catalog attached (parseMatchReply format). Throws when the plan has no hotlist. */
  match: (bug: MatchBugInput, planId: string) => Promise<string>;
  bundle: (reports: BundleReportInput[], label: string) => Promise<string>;
  hotlistForPlan: (planId: string) => string | null;
  allowedHotlists: () => string[];
  issuesCli: (argv: string[]) => Promise<string>;
}

export interface WorkerConfig {
  /** Supabase project URL (live) or the mock's base URL (dev). REST lives at `${url}/rest/v1`. */
  url: string;
  key: string;
  /** 'realtime' = Supabase postgres_changes, 'sse' = mock feed at `${url}/__events`, 'none' = sweep only. */
  events: 'realtime' | 'sse' | 'none';
  ports: WorkerPorts;
}

type Owned = 'refined' | 'repro_matches' | 'filed' | 'file_pending' | 'bundle';
const OWNED: Owned[] = ['refined', 'repro_matches', 'filed', 'file_pending', 'bundle'];
const PROBED = [...OWNED, 'status', 'title', 'environment', 'original_timestamp'] as const;

/** A merged report as the app sees it, plus where it lives. */
export interface WBug extends BugLog { _hasRow: boolean; _runJson?: any }

// ---------- REST ----------
class Rest {
  constructor(private base: string, private key: string) {}
  private headers(extra: Record<string, string> = {}) {
    return { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', ...extra };
  }
  async req(method: string, pathAndQuery: string, body?: unknown, prefer?: string): Promise<{ ok: boolean; status: number; data: any }> {
    const res = await fetch(`${this.base}/rest/v1/${pathAndQuery}`, { method, headers: this.headers(prefer ? { Prefer: prefer } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
  }
  async get(q: string): Promise<any[]> {
    const r = await this.req('GET', q);
    if (!r.ok) throw Object.assign(new Error(`GET ${q.split('?')[0]} ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`), { status: r.status, data: r.data });
    return Array.isArray(r.data) ? r.data : [];
  }
}
const isMissingColumn = (d: any) => /42703|PGRST204/.test(String(d?.code)) || /column/i.test(String(d?.message || ''));
const isMissingTable = (d: any) => /42P01|PGRST205/.test(String(d?.code));

// ---------- merging (mirrors fetchAllSupabaseData) ----------
function rowToBug(r: any): WBug {
  return {
    id: r.id, testRunId: r.test_run_id, planId: r.plan_id, stepId: r.step_id || '', stepTitle: r.step_title || '', feature: r.feature || '',
    testerName: r.tester_name || '', deviceName: r.device_name || '', severity: r.severity || 'medium', note: r.note || '', imageUrl: r.image_url,
    timestamp: r.timestamp || '', formattedTime: r.formatted_time || '',
    environment: r.environment && typeof r.environment === 'object' ? r.environment : undefined,
    title: typeof r.title === 'string' && r.title.trim() ? r.title : undefined,
    refined: r.refined && typeof r.refined === 'object' ? r.refined : undefined,
    originalTimestamp: typeof r.original_timestamp === 'string' && r.original_timestamp ? r.original_timestamp : undefined,
    status: typeof r.status === 'string' && r.status ? r.status : undefined,
    filed: r.filed && typeof r.filed === 'object' ? r.filed : undefined,
    reproMatches: r.repro_matches && typeof r.repro_matches === 'object' ? r.repro_matches : undefined,
    filePending: r.file_pending && typeof r.file_pending === 'object' ? r.file_pending : undefined,
    bundle: r.bundle && typeof r.bundle === 'object' ? r.bundle : undefined,
    _hasRow: true,
  } as WBug;
}
const CAMEL: Record<Owned, keyof BugLog> = { refined: 'refined', repro_matches: 'reproMatches', filed: 'filed', file_pending: 'filePending', bundle: 'bundle' };

export function mergeBugs(rows: any[], runs: any[], wipedAt = 0): Map<string, WBug> {
  const map = new Map<string, WBug>();
  const rowKeys = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r?.id) continue;
    const ts = Date.parse(r.timestamp || '') || 0;
    if (wipedAt && ts && ts <= wipedAt) continue;
    map.set(r.id, rowToBug(r));
    rowKeys.set(r.id, new Set(Object.keys(r)));
  }
  for (const run of runs) {
    for (const b of Array.isArray(run?.bug_logs) ? run.bug_logs : []) {
      if (!b?.id) continue;
      const ts = Date.parse(b.timestamp || '') || 0;
      if (wipedAt && ts && ts <= wipedAt) continue;
      const existing = map.get(b.id);
      if (!existing) {
        map.set(b.id, { ...b, planId: b.planId || run.plan_id, testRunId: b.testRunId || run.id, _hasRow: false, _runJson: b });
        continue;
      }
      const keys = rowKeys.get(b.id)!;
      const merged: any = { ...existing, environment: existing.environment || b.environment, title: existing.title || b.title, originalTimestamp: existing.originalTimestamp || b.originalTimestamp, status: existing.status || b.status, _runJson: b };
      for (const col of OWNED) if (!keys.has(col)) merged[CAMEL[col]] = (existing as any)[CAMEL[col]] || b[CAMEL[col]];
      map.set(b.id, merged);
    }
  }
  return map;
}

/** Minimal bug_logs row for a report that only exists in run JSON (base fields as the app writes them). */
function minimalRow(b: WBug, cols: Set<string>): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: b.id, test_run_id: b.testRunId, plan_id: b.planId, step_id: b.stepId, step_title: b.stepTitle, feature: b.feature,
    tester_name: b.testerName, device_name: b.deviceName, severity: b.severity, note: b.note, image_url: b.imageUrl ?? null,
    timestamp: b.timestamp, formatted_time: b.formattedTime,
  };
  if (cols.has('title')) row.title = (b.title || '').trim() || null;
  if (cols.has('environment') && b.environment) row.environment = b.environment;
  if (cols.has('original_timestamp')) row.original_timestamp = b.originalTimestamp || null;
  if (cols.has('status')) row.status = b.status || null;
  return row;
}

// ---------- helpers ----------
const isFiled = (b: BugLog) => !!b.filed;
const currentRefine = (b: BugLog) => !!b.refined && b.refined.sig === bugTextSig(b) && !!b.refined.title;
const currentMatches = (b: BugLog) => !!b.reproMatches && b.reproMatches.sig === bugTextSig(b);
const hasText = (b: BugLog) => !!((b.title || '').trim() || (b.note || '').trim());
const bugDay = (b: BugLog) => laDay(b.originalTimestamp || b.timestamp);

/** Bundle candidates for one plan-day: unfiled, not waiting, not bundled, not Repro'd. */
export const isBundleCandidate = (b: BugLog) => !isFiled(b) && !b.filePending && !b.bundle && b.status !== REPROD && hasText(b) && !!b.planId;

/** Parses `issues readonly list-updates` into versions (newest first in the CLI output). */
export function parseIssueUpdates(out: string): Array<{ at: string; by: string; text: string }> {
  const parts = out.split(/^Version \d+ by (\S+) at (\S+?):\s*$/m);
  const res: Array<{ at: string; by: string; text: string }> = [];
  for (let i = 1; i + 2 < parts.length + 1; i += 3) res.push({ by: parts[i], at: parts[i + 1], text: parts[i + 2] || '' });
  return res;
}
/** Parses search output with created_time. */
export function parseSearchWithCreated(out: string): Array<{ id: string; created: string }> {
  return out.split(/\n-{3,}\s*\n/).map(block => ({
    id: (block.match(/^Issue ID:\s*(\d+)/m)?.[1] || ''),
    created: (block.match(/^Created Time:\s*(\S+)/m)?.[1] || ''),
  })).filter(x => x.id);
}

// ---------- the worker ----------
export function startWorker(cfg: WorkerConfig): { stop: () => void; kick: () => void; state: () => unknown } {
  const { ports } = cfg;
  const log = (...m: unknown[]) => ports.log('[worker]', ...m);
  const rest = new Rest(cfg.url.replace(/\/$/, ''), cfg.key);
  const startedAt = new Date().toISOString();

  // schema detection (re-probed every 10 min so running the SQL needs no restart)
  const cols = new Set<string>();
  let suggestionsTable = false;
  let probedAt = 0;
  const warned = new Set<string>();
  const warnOnce = (key: string, ...m: unknown[]) => { if (!warned.has(key)) { warned.add(key); log(...m); } };
  async function probe(force = false) {
    if (!force && Date.now() - probedAt < 10 * 60_000) return;
    probedAt = Date.now();
    for (const c of PROBED) {
      const r = await rest.req('GET', `bug_logs?select=id,${c}&limit=1`);
      if (r.ok) { if (!cols.has(c)) { cols.add(c); warned.delete(`col:${c}`); } } else if (isMissingColumn(r.data)) cols.delete(c);
    }
    const t = await rest.req('GET', `${SUGGESTIONS}?select=id&limit=1`);
    suggestionsTable = t.ok;
    if (t.ok) warned.delete('table');
  }
  const need = (job: string, ...required: string[]) => {
    const missing = required.filter(c => !cols.has(c));
    if (missing.length) { warnOnce(`col:${missing[0]}:${job}`, `${job} skipped: bug_logs is missing column(s) ${missing.join(', ')} (run the SQL)`); return false; }
    return true;
  };

  // snapshot
  async function loadSnapshot(): Promise<Map<string, WBug>> {
    const [rows, runs, archived, features] = await Promise.all([
      rest.get('bug_logs?select=*&limit=10000'),
      rest.get('test_runs?select=id,plan_id,bug_logs&limit=5000'),
      rest.get('archived_runs?select=id,plan_id,bug_logs&limit=5000'),
      rest.get('populated_features?select=feature_name&feature_name=like.__GLOBAL_BUGS_WIPED_AT__*&limit=100').catch(() => [] as any[]),
    ]);
    let wipedAt = 0;
    for (const f of features) { const ts = parseInt(String(f.feature_name || '').split(':')[1], 10); if (ts > wipedAt) wipedAt = ts; }
    return mergeBugs(rows, [...runs, ...archived], wipedAt);
  }
  const recent = (b: BugLog) => { const t = Date.parse(b.originalTimestamp || b.timestamp || ''); return Number.isFinite(t) && Date.now() - t <= WATCH_DAYS * DAY_MS; };

  /** Writes worker-owned columns for one bug (PATCH, or minimal-row insert for JSON-only bugs). */
  async function writeOwned(fresh: WBug, values: Partial<Record<Owned, unknown>>): Promise<boolean> {
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) if (cols.has(k)) body[k] = v;
    if (!Object.keys(body).length) return false;
    if (!fresh._hasRow) {
      if (!recent(fresh)) return false;
      const ins = await rest.req('POST', 'bug_logs', { ...minimalRow(fresh, cols), ...body }, 'resolution=ignore-duplicates,return=representation');
      if (ins.ok && Array.isArray(ins.data) && ins.data.length) return true;
      if (!ins.ok && isMissingColumn(ins.data)) { probedAt = 0; log('insert failed (schema):', JSON.stringify(ins.data).slice(0, 200)); return false; }
      if (!ins.ok) { log('insert failed', fresh.id, ins.status, JSON.stringify(ins.data).slice(0, 200)); return false; }
      // a row appeared meanwhile (the app saved it) - fall through to PATCH
    }
    const r = await rest.req('PATCH', `bug_logs?id=eq.${encodeURIComponent(fresh.id)}`, body, 'return=minimal');
    if (!r.ok) {
      if (isMissingColumn(r.data)) probedAt = 0;
      log('patch failed', fresh.id, r.status, JSON.stringify(r.data).slice(0, 200));
      return false;
    }
    return true;
  }

  // ---------- job queue (one RX95 chat at a time for the worker) ----------
  type Job = { key: string; kind: 'refine' | 'match' | 'bundle'; run: () => Promise<void>; size: number };
  const queue: Job[] = [];
  const queued = new Set<string>();
  let running: Job | null = null;
  const backoff = new Map<string, { until: number; fails: number }>();
  const inBackoff = (k: string) => (backoff.get(k)?.until || 0) > Date.now();
  const fail = (k: string, e: unknown, minMs = 60_000) => {
    const prev = backoff.get(k)?.fails || 0;
    backoff.set(k, { fails: prev + 1, until: Date.now() + Math.min(30 * 60_000, minMs * 2 ** prev) });
    log(`job ${k} failed:`, (e as any)?.message || e);
  };
  const rateLimited = new Map<string, number>();
  function enqueue(job: Job) {
    if (queued.has(job.key) || running?.key === job.key || inBackoff(job.key)) return;
    queued.add(job.key);
    queue.push(job);
    void pump();
  }
  async function pump() {
    if (running) return;
    while (queue.length) {
      // repro checks first (a person is waiting on them), then refine, then bundles
      queue.sort((a, b) => ['match', 'refine', 'bundle'].indexOf(a.kind) - ['match', 'refine', 'bundle'].indexOf(b.kind));
      const job = queue.shift()!;
      queued.delete(job.key);
      if (!ports.allow(job.kind)) {
        if ((rateLimited.get(job.kind) || 0) < Date.now()) { log(`${job.kind} rate limit reached; pausing ${job.kind} jobs for 5 min`); rateLimited.set(job.kind, Date.now() + 5 * 60_000); }
        backoff.set(job.key, { fails: 0, until: Date.now() + 5 * 60_000 });
        continue;
      }
      running = job;
      try { await job.run(); backoff.delete(job.key); } catch (e) { fail(job.key, e); }
      running = null;
    }
  }

  // ---------- job builders ----------
  function refineJob(batch: WBug[]): Job {
    const key = `refine:${batch.map(b => `${b.id}@${bugTextSig(b).length}`).join(',')}`.slice(0, 400);
    return {
      key, kind: 'refine', size: batch.length,
      run: async () => {
        const inputs = batch.map(toRefineInput);
        const reply = await ports.refine(inputs);
        const results = parseRefineReply(reply, batch);
        const fresh = await loadSnapshot();
        let wrote = 0;
        for (const b of batch) {
          const r: RefinedBugText | undefined = results[b.id];
          const f = fresh.get(b.id);
          if (!r || !f || bugTextSig(f) !== r.sig || currentRefine(f)) continue; // edited meanwhile, gone, or already refined
          if (await writeOwned(f, { refined: r })) wrote++;
        }
        log(`refine: ${wrote}/${batch.length} written`);
        for (const b of batch) if (!results[b.id]) backoff.set(`refine1:${b.id}:${bugTextSig(b)}`, { fails: 1, until: Date.now() + 30 * 60_000 });
      },
    };
  }

  function matchJob(b: WBug): Job {
    const sig = bugTextSig(b);
    return {
      key: `match:${b.id}:${sig}`, kind: 'match', size: 1,
      run: async () => {
        const reply = await ports.match(toMatchInput(b), b.planId);
        const { meta, candidates } = parseMatchReply(reply);
        if (!meta.hotlistId) throw new Error('match reply without hotlist');
        const result: ReproMatches = { sig, hotlistId: meta.hotlistId, searched: meta.searched, at: new Date().toISOString(), candidates };
        const f = (await loadSnapshot()).get(b.id);
        if (!f || bugTextSig(f) !== sig || f.status !== REPROD || isFiled(f) || currentMatches(f)) { log('match: dropped stale result for', b.id); return; }
        if (await writeOwned(f, { repro_matches: result })) log(`match: ${b.id} -> ${candidates.length} candidate(s)`);
      },
    };
  }

  const bundleRows = new Map<string, { sig: string; empty: boolean }>();
  const planDaySeen = new Map<string, { sig: string; at: number }>();
  function bundleJob(planId: string, day: string, cands: WBug[], sig: string): Job {
    const id = `${planId}|${day}`;
    return {
      key: `bundle:${id}:${sig}`, kind: 'bundle', size: cands.length,
      run: async () => {
        const suggestions: BundleSuggestion[] = [];
        const chunks = splitForPrompt(cands.map(toBundleInput));
        for (const [i, chunk] of chunks.entries()) {
          const reply = await ports.bundle(chunk, `${day}${chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : ''}`);
          const parsed = parseBundleReply(reply, chunk);
          if (!parsed) throw new Error('unreadable bundle reply');
          suggestions.push(...parsed);
        }
        const fresh = await loadSnapshot();
        const now = [...fresh.values()].filter(b => b.planId === planId && bugDay(b) === day && isBundleCandidate(b));
        if (bundleGroupSig(now) !== sig) { log(`bundle: ${id} changed meanwhile; will re-run`); return; }
        await writeSuggestions(planId, day, sig, suggestions);
        log(`bundle: ${id} -> ${suggestions.length} suggestion(s) from ${cands.length} report(s)`);
      },
    };
  }
  async function writeSuggestions(planId: string, day: string, sig: string, suggestions: BundleSuggestion[]) {
    const id = `${planId}|${day}`;
    const at = new Date().toISOString();
    const payload: BundleSuggestionSet = { id, planId, day, sig, at, suggestions };
    const r = await rest.req('POST', SUGGESTIONS, { id, plan_id: planId, day, sig, payload, updated_at: at }, 'resolution=merge-duplicates,return=minimal');
    if (!r.ok) {
      if (isMissingTable(r.data)) { suggestionsTable = false; probedAt = 0; }
      throw new Error(`suggestions write failed ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    }
    bundleRows.set(id, { sig, empty: suggestions.length === 0 });
  }

  // ---------- planning (one pass over a fresh snapshot) ----------
  let lastSnapshot: Map<string, WBug> = new Map();
  let planning = false;
  let dirty = false;
  async function plan() {
    if (planning) { dirty = true; return; }
    planning = true;
    try {
      do {
        dirty = false;
        await probe();
        const snap = await loadSnapshot();
        lastSnapshot = snap;
        const live = [...snap.values()].filter(recent);

        // refine: newest first, unfiled reports without a current refinement
        if (need('refine', 'refined')) {
          const todo = live
            .filter(b => hasText(b) && !isFiled(b) && !currentRefine(b) && !inBackoff(`refine1:${b.id}:${bugTextSig(b)}`))
            .filter(b => !running || running.kind !== 'refine' || !running.key.includes(b.id))
            .sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));
          for (let i = 0; i < todo.length; i += REFINE_MAX_BUGS_PER_REQUEST) enqueue(refineJob(todo.slice(i, i + REFINE_MAX_BUGS_PER_REQUEST)));
        }

        // match: Repro'd, unfiled, no current matches, plan has a hotlist
        if (need('match', 'repro_matches')) {
          for (const b of live) {
            if (b.status !== REPROD || isFiled(b) || currentMatches(b) || !hasText(b)) continue;
            if (!ports.hotlistForPlan(b.planId)) { warnOnce(`nohot:${b.planId}`, `match skipped: no hotlist configured for ${b.planId}`); continue; }
            enqueue(matchJob(b));
          }
        }

        // bundles: per plan-day
        if (!suggestionsTable) warnOnce('table', `bundle suggestions + heartbeat skipped: table ${SUGGESTIONS} is missing (run the SQL)`);
        else {
          if (!bundleRows.size) {
            for (const r of await rest.get(`${SUGGESTIONS}?select=id,sig,payload&limit=1000`).catch(() => [] as any[]))
              if (r.id !== '_heartbeat') bundleRows.set(r.id, { sig: r.sig || '', empty: !(r.payload?.suggestions?.length) });
          }
          const groups = new Map<string, WBug[]>();
          for (const b of live) {
            if (!isBundleCandidate(b)) continue;
            const day = bugDay(b);
            if (!day) continue;
            const k = `${b.planId}|${day}`;
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k)!.push(b);
          }
          // plan-days that lost all candidates still need their old suggestions cleared
          for (const k of bundleRows.keys()) if (!groups.has(k) && !bundleRows.get(k)!.empty && recentDay(k.split('|')[1])) groups.set(k, []);
          for (const [k, cands] of groups) {
            const [planId, day] = k.split('|');
            const sig = bundleGroupSig(cands);
            const row = bundleRows.get(k);
            if (row?.sig === sig) continue;
            if (cands.length < 2) {
              if (row && !row.empty) await writeSuggestions(planId, day, sig, []).catch(e => log('clear suggestions failed', e.message));
              else bundleRows.set(k, { sig, empty: true });
              continue;
            }
            // let the wording cleanup land first (better input), but never wait more than 3 min
            const seen = planDaySeen.get(k);
            if (!seen || seen.sig !== sig) planDaySeen.set(k, { sig, at: Date.now() });
            const waiting = cols.has('refined') && cands.some(b => !currentRefine(b) && !inBackoff(`refine1:${b.id}:${bugTextSig(b)}`));
            if (waiting && Date.now() - planDaySeen.get(k)!.at < BUNDLE_WAIT_FOR_REFINE_MS) continue;
            enqueue(bundleJob(planId, day, cands, sig));
          }
        }
      } while (dirty);
    } catch (e: any) {
      log('plan failed:', e.message);
    } finally {
      planning = false;
    }
  }
  const recentDay = (day: string) => { const t = Date.parse(`${day}T12:00:00Z`); return Number.isFinite(t) && Date.now() - t <= (WATCH_DAYS + 1) * DAY_MS; };

  // ---------- filed confirmation ----------
  const lastChecked = new Map<string, number>();
  let confirming = false;
  async function confirmTick() {
    if (confirming) return;
    confirming = true;
    try {
      if (!need('confirm', 'filed', 'file_pending')) return;
      const snap = await loadSnapshot();
      const pending = [...snap.values()].filter(b => b.filePending && !b.filePending.expired && !isFiled(b));
      // one unit per bundle (any member's id proves the mega bug), else per bug
      const units = new Map<string, WBug[]>();
      for (const b of pending) {
        const k = b.filePending!.kind === 'bundle' && b.filePending!.bundleId ? `bundle:${b.filePending!.bundleId}` : `bug:${b.id}`;
        if (!units.has(k)) units.set(k, []);
        units.get(k)!.push(b);
      }
      let calls = 0;
      for (const [unitKey, members] of [...units].sort((a, b) => (lastChecked.get(a[0]) || 0) - (lastChecked.get(b[0]) || 0))) {
        const p = members[0].filePending as BugFilePending;
        const openedAt = Date.parse(p.openedAt || '');
        if (!Number.isFinite(openedAt)) continue;
        if (Date.now() - openedAt > CONFIRM_WINDOW_MS) {
          for (const m of members) await writeOwned(m, { file_pending: { ...m.filePending, expired: true } });
          log(`confirm: ${unitKey} expired after 24h without proof`);
          continue;
        }
        if (Date.now() - (lastChecked.get(unitKey) || 0) < CONFIRM_EVERY_MS - 1000) continue;
        if (calls >= CONFIRM_MAX_CLI_PER_TICK) break;
        lastChecked.set(unitKey, Date.now());
        const since = openedAt - 10 * 60_000;
        let issueId: string | null = null;
        try {
          if (p.kind === 'follow-up') {
            if (!/^\d{4,12}$/.test(String(p.issueId || ''))) continue;
            calls++;
            const updates = parseIssueUpdates(await ports.issuesCli(['list-updates', String(p.issueId), '--limit', '50']));
            const ids = members.map(m => m.id).filter(id => BUG_ID.test(id));
            if (updates.some(u => Date.parse(u.at) >= since && ids.some(id => u.text.includes(id)))) issueId = String(p.issueId);
          } else {
            for (const m of members) {
              if (!BUG_ID.test(m.id) || calls >= CONFIRM_MAX_CLI_PER_TICK) continue;
              const allowed = ports.allowedHotlists();
              const hot = [ports.hotlistForPlan(m.planId), allowed.includes(String(p.hotlistId)) ? String(p.hotlistId) : null].filter(Boolean) as string[];
              const queries = [...new Set(hot)].map(h => `hotlistid:${h} "${m.id}"`);
              queries.push(`"${m.id}"`); // fallback: anywhere (the id is unique; e.g. the hotlist was removed in the form)
              for (const q of queries) {
                calls++;
                const found = parseSearchWithCreated(await ports.issuesCli(['search', q, '--limit', '10', '--fields', 'issue_id,created_time']))
                  .filter(x => Date.parse(x.created) >= since)
                  .sort((a, b) => Date.parse(a.created) - Date.parse(b.created));
                if (found.length) { issueId = found[0].id; break; }
              }
              if (issueId) break;
            }
          }
        } catch (e: any) {
          log(`confirm: ${unitKey} check failed:`, e.message);
          continue;
        }
        if (!issueId) continue;
        const fresh = await loadSnapshot();
        for (const m of members) {
          const f = fresh.get(m.id);
          if (!f || !f.filePending || f.filePending.openedAt !== p.openedAt || isFiled(f)) continue;
          const filed: BugFiled = { issueId, via: p.kind === 'follow-up' ? 'follow-up' : p.kind === 'bundle' ? 'bundle' : 'new', confirmed: true, at: new Date().toISOString(), by: 'rx95' };
          if (await writeOwned(f, { filed, file_pending: null })) log(`confirm: ${f.id} filed as b/${issueId} (${filed.via})`);
        }
      }
    } catch (e: any) {
      log('confirm tick failed:', e.message);
    } finally {
      confirming = false;
    }
  }

  // ---------- heartbeat ----------
  const queueSizes = () => {
    const count = (k: Job['kind']) => queue.filter(j => j.kind === k).reduce((n, j) => n + j.size, 0) + (running?.kind === k ? running.size : 0);
    const confirm = [...lastSnapshot.values()].filter(b => b.filePending && !b.filePending.expired && !isFiled(b)).length;
    return { refine: count('refine'), match: count('match'), bundle: count('bundle'), confirm };
  };
  async function heartbeat() {
    if (!suggestionsTable) return;
    const at = new Date().toISOString();
    const r = await rest.req('POST', SUGGESTIONS, { id: '_heartbeat', plan_id: null, day: null, sig: '', payload: { at, startedAt, version: WORKER_VERSION, queues: queueSizes() }, updated_at: at }, 'resolution=merge-duplicates,return=minimal').catch(e => ({ ok: false, status: 0, data: { message: e.message } }));
    if (!r.ok) {
      if (isMissingTable(r.data)) { suggestionsTable = false; probedAt = 0; }
      warnOnce(`hb:${r.status}`, 'heartbeat failed', r.status, JSON.stringify(r.data).slice(0, 200));
    }
  }

  // ---------- triggers ----------
  let coalesce: NodeJS.Timeout | null = null;
  const kick = () => {
    if (coalesce) clearTimeout(coalesce);
    coalesce = setTimeout(() => { coalesce = null; void plan(); }, COALESCE_MS);
  };
  let stopEvents = () => {};
  if (cfg.events === 'realtime') {
    const client = createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false } });
    const channel = client.channel('rx95-worker');
    for (const table of ['bug_logs', 'test_runs', 'archived_runs']) channel.on('postgres_changes' as any, { event: '*', schema: 'public', table }, () => kick());
    channel.subscribe((status: string) => log('realtime:', status));
    stopEvents = () => { void client.removeChannel(channel); };
  } else if (cfg.events === 'sse') {
    let stopped = false;
    const controller = new AbortController();
    (async () => {
      while (!stopped) {
        try {
          const res = await fetch(`${cfg.url.replace(/\/$/, '')}/__events`, { signal: controller.signal });
          const reader = res.body!.getReader();
          log('sse: connected');
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            if (new TextDecoder().decode(value).includes('data:')) kick();
          }
        } catch (e: any) { if (!stopped) log('sse: disconnected', e.message); }
        if (!stopped) await new Promise(r => setTimeout(r, 2000));
      }
    })();
    stopEvents = () => { stopped = true; controller.abort(); };
  }
  const timers = [
    setInterval(() => void plan(), SWEEP_MS),
    setInterval(() => void heartbeat(), HEARTBEAT_MS),
    setInterval(() => void confirmTick(), Math.min(CONFIRM_EVERY_MS, 60_000)),
  ];
  void probe(true).then(() => { void heartbeat(); void plan(); void confirmTick(); });
  log(`started (${cfg.events} trigger, sweep ${SWEEP_MS / 1000}s)`);

  return {
    stop: () => { timers.forEach(clearInterval); stopEvents(); if (coalesce) clearTimeout(coalesce); },
    kick,
    state: () => ({ cols: [...cols], suggestionsTable, queue: queue.map(j => j.key), running: running?.key, queues: queueSizes() }),
  };
}

export type { BugBundle };
