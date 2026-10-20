/**
 * Mock Supabase (PostgREST subset) for developing / QA-ing the RX95 background worker without
 * touching live data. Pure in-memory (optionally persisted), localhost only.
 *
 *   npx tsx tools/rx95-bridge/mock-supabase.ts --port=54329 [--seed=seed.json] [--state=state.json]
 *        [--missing=bug_logs.file_pending,bug_logs.bundle,rx95_bundle_suggestions]
 *
 * Then run the bridge against it (never the live project):
 *   RX95_SUPABASE_URL=http://127.0.0.1:54329 RX95_ISSUES_CLI=$PWD/tools/rx95-bridge/fake-issues-cli.mjs \
 *   FAKE_ISSUES_FILE=/tmp/fake-issues.json npx tsx tools/rx95-bridge/watcher.ts --mode=dev-supabase [--rx95=fake]
 *
 * REST (enough for the worker and the app's reads):
 *   GET    /rest/v1/<table>?select=a,b|*&<col>=eq.<v>|neq.|lt.|gt.|like.<pat*>|is.null&order=<col>.asc|desc&limit=N
 *   POST   /rest/v1/<table>   body row|rows; Prefer: resolution=merge-duplicates|ignore-duplicates, return=representation|minimal
 *   PATCH  /rest/v1/<table>?<filters>   body partial row; Prefer: return=representation
 *   DELETE /rest/v1/<table>?<filters>
 *   Unknown columns -> 400 {code:'PGRST204'} / select -> 400 {code:'42703'}; unknown table -> 404 {code:'PGRST205'}.
 * Writes containing a NUL character are rejected with 400 {code:'22P05'} like Postgres.
 * Change feed: GET /__events (Server-Sent Events, one `data: {table,type,id}` per write) - the worker's
 *   dev trigger (stands in for Supabase realtime).
 * Admin (for tests):
 *   GET  /__admin/state                     full dump
 *   POST /__admin/fire {table,id?}          emit a change event without writing
 *   POST /__admin/schema {table, drop?:[cols], add?:[cols], dropTable?:bool, createTable?:[cols]}
 *   POST /__admin/reset {seed?}             reload seed (or the given seed object)
 *   GET  /__admin/log                       last 200 writes (method, table, filter, body) - check who wrote what
 *   GET  /__admin/stats, POST /__admin/stats/reset   REST requests + bytes served per "METHOD table" (load checks)
 */
import fs from 'node:fs';
import http from 'node:http';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.join('=') || 'true'];
}));
const PORT = Number(args.port || 54329);

type Row = Record<string, any>;
interface Table { columns: Set<string>; pk: string; rows: Row[] }
let tables = new Map<string, Table>();

const DEFAULT_SCHEMA: Record<string, string[]> = {
  bug_logs: ['id', 'test_run_id', 'plan_id', 'step_id', 'step_title', 'feature', 'tester_name', 'device_name', 'severity', 'note', 'image_url', 'timestamp', 'formatted_time',
    'environment', 'title', 'refined', 'original_timestamp', 'status', 'filed', 'repro_matches', 'bundle', 'file_pending', 'reviewed', 'updated_at'],
  test_runs: ['id', 'plan_id', 'plan_name', 'tester_name', 'device_name', 'device_id', 'status', 'current_step_index', 'results', 'bug_logs', 'started_at', 'completed_at', 'duration_ms'],
  archived_runs: ['id', 'plan_id', 'plan_name', 'tester_name', 'device_name', 'device_id', 'status', 'current_step_index', 'results', 'bug_logs', 'started_at', 'completed_at', 'duration_ms'],
  test_plans: ['id', 'name', 'description', 'steps', 'created_at'],
  populated_features: ['id', 'feature_name'],
  ai_summary_requests: ['id', 'status', 'payload', 'reply', 'error', 'report_id', 'conversation_id', 'created_at', 'updated_at'],
  rx95_bundle_suggestions: ['id', 'plan_id', 'day', 'sig', 'payload', 'updated_at'],
};
const DEFAULTS: Record<string, Record<string, () => unknown>> = {
  bug_logs: { updated_at: () => new Date().toISOString() },
  ai_summary_requests: { created_at: () => new Date().toISOString(), updated_at: () => new Date().toISOString() },
  rx95_bundle_suggestions: { updated_at: () => new Date().toISOString() },
};

function load(seed?: any) {
  tables = new Map();
  for (const [name, cols] of Object.entries(DEFAULT_SCHEMA)) tables.set(name, { columns: new Set(cols), pk: name === 'populated_features' ? 'feature_name' : 'id', rows: [] });
  const s = seed ?? (args.state && fs.existsSync(args.state) ? JSON.parse(fs.readFileSync(args.state, 'utf8')) : args.seed ? JSON.parse(fs.readFileSync(args.seed, 'utf8')) : {});
  for (const [name, entry] of Object.entries(s.tables || s || {})) {
    const rawRows: Row[] = Array.isArray(entry) ? entry : Array.isArray((entry as any)?.rows) ? (entry as any).rows : [];
    if (!tables.has(name)) tables.set(name, { columns: new Set(Object.keys(rawRows[0] || { id: 1 })), pk: 'id', rows: [] });
    const t = tables.get(name)!;
    for (const r of rawRows) {
      if (r && typeof r === 'object') {
        for (const col of Object.keys(r)) t.columns.add(col);
      }
    }
    t.rows = JSON.parse(JSON.stringify(rawRows));
  }
  for (const m of String(args.missing || '').split(',').filter(Boolean)) {
    const [t, c] = m.split('.');
    if (c) tables.get(t)?.columns.delete(c); else tables.delete(t);
  }
}
load();
const persist = () => { if (args.state) fs.writeFileSync(args.state, JSON.stringify({ tables: Object.fromEntries([...tables].map(([k, t]) => [k, t.rows])) }, null, 1)); };

// ---------- change feed ----------
const listeners = new Set<http.ServerResponse>();
function emit(ev: { table: string; type: string; id?: string }) {
  const line = `data: ${JSON.stringify({ ...ev, at: new Date().toISOString() })}\n\n`;
  for (const res of listeners) res.write(line);
}
const writeLog: unknown[] = [];
const hasNul = (v: unknown): boolean => typeof v === 'string' ? v.includes('\u0000') : Array.isArray(v) ? v.some(hasNul) : !!v && typeof v === 'object' && Object.entries(v).some(([k, x]) => k.includes('\u0000') || hasNul(x));
const stats = new Map<string, { requests: number; bytesOut: number }>();
const logWrite = (entry: unknown) => { writeLog.push({ at: new Date().toISOString(), ...(entry as object) }); if (writeLog.length > 200) writeLog.shift(); };

// ---------- filtering ----------
function parseFilters(q: URLSearchParams) {
  const filters: Array<(r: Row) => boolean> = [];
  const used: string[] = [];
  const conds: Array<[string, string]> = [];
  for (const [k, v] of q) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue;
    if (k === 'or') {
      // or=(a.op.v,b.op.v): any of the conditions
      const parts = v.replace(/^\(|\)$/g, '').split(',').map(p => { const i = p.indexOf('.'); return [p.slice(0, i), p.slice(i + 1)] as [string, string]; });
      parts.forEach(([c]) => used.push(c));
      const subs = parts.map(([c, cond]) => parseFilters(new URLSearchParams([[c, cond]])).match);
      filters.push(r => subs.some(f => f(r)));
      continue;
    }
    conds.push([k, v]);
  }
  for (const [k, v0] of conds) {
    used.push(k);
    const neg = v0.startsWith('not.');
    const v = neg ? v0.slice(4) : v0;
    const m = v.match(/^(eq|neq|lt|lte|gt|gte|like|ilike|is|in)\.(.*)$/s);
    if (!m) continue;
    const [, op, raw] = m;
    const test = (r: Row): boolean => {
    const cmp = (a: any) => (a === null || a === undefined ? '' : typeof a === 'object' ? JSON.stringify(a) : String(a));
      const val = r[k];
      switch (op) {
        case 'eq': return cmp(val) === raw;
        case 'neq': return cmp(val) !== raw;
        case 'lt': return cmp(val) < raw;
        case 'lte': return cmp(val) <= raw;
        case 'gt': return cmp(val) > raw;
        case 'gte': return cmp(val) >= raw;
        case 'like': case 'ilike': {
          const re = new RegExp(`^${raw.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/%/g, '.*')}$`, op === 'ilike' ? 'i' : '');
          return re.test(cmp(val));
        }
        case 'is': return raw === 'null' ? val === null || val === undefined : String(val) === raw;
        case 'in': return raw.replace(/^\(|\)$/g, '').split(',').map(x => x.replace(/^"|"$/g, '')).includes(cmp(val));
      }
      return true;
    };
    filters.push(r => (neg ? !test(r) : test(r)));
  }
  return { match: (r: Row) => filters.every(f => f(r)), used };
}

const err = (res: http.ServerResponse, code: number, body: object) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const ok = (res: http.ServerResponse, code: number, body?: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return ok(res, 204);
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  if (!url.pathname.startsWith('/__')) {
    const byId = /(^|&)id=(eq|in)\./.test(url.search.slice(1));
    const key = `${req.method} ${url.pathname.replace('/rest/v1/', '')}${byId ? ' (by id)' : ''}`;
    const end = res.end.bind(res) as (...a: any[]) => http.ServerResponse;
    (res as any).end = (chunk?: any, ...rest: any[]) => {
      const st = stats.get(key) || { requests: 0, bytesOut: 0 };
      st.requests++;
      st.bytesOut += chunk ? Buffer.byteLength(chunk) : 0;
      stats.set(key, st);
      return end(chunk, ...rest);
    };
  }
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    let json: any = undefined;
    try { json = body ? JSON.parse(body) : undefined; } catch { return err(res, 400, { message: 'bad json' }); }
    // Like Postgres: NUL is not allowed in text/jsonb (22P05) - the whole write fails
    if (hasNul(json)) return err(res, 400, { code: '22P05', details: '\\u0000 cannot be converted to text.', hint: null, message: 'unsupported Unicode escape sequence' });

    if (url.pathname === '/__events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': connected\n\n');
      listeners.add(res);
      res.on('close', () => listeners.delete(res)); // (req 'close' fires as soon as the GET body is read)
      return;
    }
    if (url.pathname === '/__admin/state') return ok(res, 200, { tables: Object.fromEntries([...tables].map(([k, t]) => [k, { columns: [...t.columns], rows: t.rows }])) });
    if (url.pathname === '/__admin/log') return ok(res, 200, writeLog);
    if (url.pathname === '/__admin/stats') return ok(res, 200, Object.fromEntries(stats));
    if (url.pathname === '/__admin/stats/reset' && req.method === 'POST') { stats.clear(); return ok(res, 200, { ok: true }); }
    if (url.pathname === '/__admin/fire' && req.method === 'POST') { emit({ table: json?.table || 'bug_logs', type: 'UPDATE', id: json?.id }); return ok(res, 200, { ok: true }); }
    if (url.pathname === '/__admin/reset' && req.method === 'POST') { load(json?.seed); persist(); emit({ table: 'bug_logs', type: 'RESET' }); return ok(res, 200, { ok: true }); }
    if (url.pathname === '/__admin/schema' && req.method === 'POST') {
      const t = tables.get(json?.table);
      if (json?.createTable) tables.set(json.table, { columns: new Set(json.createTable), pk: 'id', rows: [] });
      else if (json?.dropTable) tables.delete(json.table);
      else if (t) { for (const c of json?.drop || []) t.columns.delete(c); for (const c of json?.add || []) t.columns.add(c); }
      return ok(res, 200, { ok: true, columns: tables.get(json?.table) ? [...tables.get(json.table)!.columns] : null });
    }

    const m = url.pathname.match(/^\/rest\/v1\/([\w]+)$/);
    if (!m) return err(res, 404, { message: 'not found' });
    const name = m[1];
    const table = tables.get(name);
    if (!table) return err(res, 404, { code: 'PGRST205', details: null, hint: null, message: `Could not find the table 'public.${name}' in the schema cache` });
    const prefer = String(req.headers.prefer || '');
    const wantRep = /return=representation/.test(prefer);
    const { match, used } = parseFilters(url.searchParams);
    for (const c of used) if (!table.columns.has(c)) return err(res, 400, { code: '42703', details: null, hint: null, message: `column ${name}.${c} does not exist` });
    const selectCols = (url.searchParams.get('select') || '*').split(',').map(s => s.trim()).filter(Boolean);
    for (const c of selectCols) if (c !== '*' && !table.columns.has(c)) return err(res, 400, { code: '42703', details: null, hint: null, message: `column ${name}.${c} does not exist` });
    const project = (r: Row) => {
      if (selectCols.includes('*')) return Object.fromEntries([...table.columns].map(c => [c, r[c] ?? null]));
      return Object.fromEntries(selectCols.map(c => [c, r[c] ?? null]));
    };
    const badCol = (row: Row) => Object.keys(row).find(c => !table.columns.has(c));

    if (req.method === 'GET') {
      let rows = table.rows.filter(match);
      const order = url.searchParams.get('order');
      if (order) { const [col, dir] = order.split('.'); rows = [...rows].sort((a, b) => (String(a[col] ?? '') < String(b[col] ?? '') ? -1 : 1) * (dir === 'desc' ? -1 : 1)); }
      const limit = Number(url.searchParams.get('limit') || 0);
      if (limit) rows = rows.slice(0, limit);
      return ok(res, 200, rows.map(project));
    }
    if (req.method === 'POST') {
      const list: Row[] = Array.isArray(json) ? json : [json];
      for (const r of list) { const c = badCol(r || {}); if (c) return err(res, 400, { code: 'PGRST204', details: null, hint: null, message: `Could not find the '${c}' column of '${name}' in the schema cache` }); }
      const out: Row[] = [];
      for (const r of list) {
        const existing = table.rows.find(x => x[table.pk] === r[table.pk]);
        if (existing) {
          if (/ignore-duplicates/.test(prefer)) continue;
          if (!/merge-duplicates/.test(prefer)) return err(res, 409, { code: '23505', message: `duplicate key value violates unique constraint "${name}_pkey"` });
          Object.assign(existing, r, table.columns.has('updated_at') && !('updated_at' in r) ? { updated_at: new Date().toISOString() } : {});
          out.push(existing);
        } else {
          const row: Row = {};
          for (const [c, f] of Object.entries(DEFAULTS[name] || {})) if (table.columns.has(c)) row[c] = f();
          Object.assign(row, r);
          table.rows.push(row);
          out.push(row);
        }
        emit({ table: name, type: existing ? 'UPDATE' : 'INSERT', id: r[table.pk] });
      }
      logWrite({ method: 'POST', table: name, prefer, ids: list.map(r => r?.[table.pk]), body: list });
      persist();
      return wantRep ? ok(res, 201, out.map(project)) : ok(res, 201);
    }
    if (req.method === 'PATCH') {
      const c = badCol(json || {});
      if (c) return err(res, 400, { code: 'PGRST204', details: null, hint: null, message: `Could not find the '${c}' column of '${name}' in the schema cache` });
      const rows = table.rows.filter(match);
      for (const r of rows) { Object.assign(r, json); emit({ table: name, type: 'UPDATE', id: r[table.pk] }); }
      logWrite({ method: 'PATCH', table: name, filter: url.search, ids: rows.map(r => r[table.pk]), body: json });
      persist();
      return wantRep ? ok(res, 200, rows.map(project)) : ok(res, 204);
    }
    if (req.method === 'DELETE') {
      const keep = table.rows.filter(r => !match(r));
      const gone = table.rows.filter(match);
      table.rows = keep;
      for (const r of gone) emit({ table: name, type: 'DELETE', id: r[table.pk] });
      logWrite({ method: 'DELETE', table: name, filter: url.search, ids: gone.map(r => r[table.pk]) });
      persist();
      return wantRep ? ok(res, 200, gone.map(project)) : ok(res, 204);
    }
    return err(res, 405, { message: 'method not allowed' });
  });
});
server.listen(PORT, '127.0.0.1', () => console.log(`mock supabase on http://127.0.0.1:${PORT} (tables: ${[...tables.keys()].join(', ')})`));
