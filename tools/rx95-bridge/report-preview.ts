/**
 * Report preview / QA harness for the RX95 + Buganizer summary.
 *
 * Builds the real CUJ report for a plan + day from live Supabase data (read-only), asks the
 * running RX95 sidecar for the summary through the ai_summary_requests queue (exactly like the
 * app's "Ask RX95" button), then renders the final report text with the app's own code.
 *
 *   npx tsx tools/rx95-bridge/report-preview.ts --plan=plan-1787946982095 --date=2026-10-13
 *   npx tsx tools/rx95-bridge/report-preview.ts --plan=... --date=... --reply-file=/path/reply.json   (skip RX95, reuse a saved reply)
 *
 * Writes <out>/report.txt, <out>/report.html, <out>/reply.json, <out>/result.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeCujReport, buildCujReportText, getKnownCujNames, mergeRunsById, type CujMetric } from '../../src/utils/cujReportUtils';
import { buildStepFirstSeenIndex } from '../../src/utils/runUtils';
import { applyChatSummaryReply, nlpCleanReword, type ExecutiveQAResult } from '../../src/services/geminiService';
import { buildRx95Payload } from '../../src/services/rx95Service';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
const PLAN = args.plan || 'plan-1787946982095';
const DATE = args.date || '2026-10-13';
const OUT = args.out || '/tmp/rx95_report_preview';
fs.mkdirSync(OUT, { recursive: true });

const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
}));
const H = { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' };
const get = async (q: string) => (await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/${q}`, { headers: H })).json();

const mapRun = (r: any) => ({
  id: r.id, planId: r.plan_id, planName: r.plan_name, testerName: r.tester_name || '', deviceName: r.device_name || '',
  deviceId: r.device_id || undefined, status: r.status, currentStepIndex: r.current_step_index || 0, results: r.results || {},
  bugLogs: r.bug_logs || [], startedAt: r.started_at, completedAt: r.completed_at || undefined,
});
const mapBug = (b: any) => ({
  id: b.id, testRunId: b.test_run_id, planId: b.plan_id, stepId: b.step_id, stepTitle: b.step_title, feature: b.feature,
  testerName: b.tester_name, deviceName: b.device_name, severity: b.severity, note: b.note, imageUrl: b.image_url,
  timestamp: b.timestamp, formattedTime: b.formatted_time,
});

const plans = (await get('test_plans?select=*')).map((p: any) => ({ id: p.id, name: p.name, description: p.description || '', steps: p.steps || [], createdAt: p.created_at }));
const runs = mergeRunsById((await get('archived_runs?select=*')).map(mapRun), (await get('test_runs?select=*')).map(mapRun));
const bugs = (await get('bug_logs?select=*')).map(mapBug);
const populated = (await get('populated_features?select=feature_name')).map((r: any) => r.feature_name).filter((n: string) => !n.startsWith('__'));

const scope = { planId: PLAN, date: DATE };
const report = computeCujReport({ plans, runs, bugs, scope, knownCujNames: getKnownCujNames(plans, bugs, populated), firstSeen: buildStepFirstSeenIndex(runs) } as any);
const planName = plans.find((p: any) => p.id === PLAN)?.name || PLAN;
const scopeContext = { scopeKey: `preview|${PLAN}|${DATE}`, scopeLabel: `the "${planName}" test plan (${DATE})` };
const featuresPayload = [...report.testedMetrics, ...report.bugOnlyMetrics].map(m => ({
  featureName: m.featureName, status: m.status, healthScorePct: m.healthScorePct, greenCount: m.greenCount,
  totalStepsExecuted: m.totalStepsExecuted, bugCount: m.associatedBugs.length, bugs: m.associatedBugs,
}));
const allBugs = featuresPayload.flatMap(f => f.bugs);
console.log(`Report: ${planName} ${DATE} - ${report.totals.testedCujCount} CUJs, ${report.totals.bugCount} app bugs`);

let reply: string;
if (args['reply-file']) {
  reply = fs.readFileSync(args['reply-file'], 'utf8');
} else {
  const id = `rx95-preview-${Date.now()}`;
  const payload = buildRx95Payload(featuresPayload as any, scopeContext, scope);
  const ins = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/ai_summary_requests`, { method: 'POST', headers: H, body: JSON.stringify({ id, status: 'pending', payload }) });
  if (!ins.ok) throw new Error(`queue insert failed ${ins.status} ${await ins.text()}`);
  const t0 = Date.now();
  for (;;) {
    await new Promise(r => setTimeout(r, 3000));
    const [row] = await get(`ai_summary_requests?id=eq.${id}&select=status,reply,error,conversation_id`);
    if (row?.status === 'done') { reply = row.reply; console.log(`RX95 replied in ${Math.round((Date.now() - t0) / 1000)}s (chat ${row.conversation_id})`); break; }
    if (row?.status === 'error') throw new Error(`RX95 error: ${row.error}`);
    if (Date.now() - t0 > 300_000) throw new Error('timed out');
  }
}
fs.writeFileSync(path.join(OUT, 'reply.json'), reply!);

const result: ExecutiveQAResult = applyChatSummaryReply(featuresPayload as any, allBugs as any, reply!, scopeContext);
fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2));
const lookup = <T,>(map: Record<string, T> | undefined, name: string) => {
  if (!map) return undefined;
  const e = Object.entries(map).find(([k]) => k.trim().toLowerCase() === name.trim().toLowerCase());
  return e ? e[1] : undefined;
};
const { plainText, htmlText } = buildCujReportText(report, {
  dateLabel: DATE,
  overallSummary: result.overallSummary,
  getSummary: (m: CujMetric) => lookup(result.featureSummaries, m.featureName) || nlpCleanReword(m.associatedBugs.map(b => b.note).filter(Boolean), m.featureName) || '',
  getIssues: (m: CujMetric) => (m.associatedBugs.length > 0 ? lookup(result.featureIssues, m.featureName) : undefined),
  getFiledBugs: (m: CujMetric) => lookup(result.featureFiledBugs, m.featureName),
  otherFiledBugs: result.otherFiledBugs,
});
fs.writeFileSync(path.join(OUT, 'report.txt'), plainText);
fs.writeFileSync(path.join(OUT, 'report.html'), htmlText);
const catalog = (() => { try { return JSON.parse(reply!).filedBugsCatalog || []; } catch { return []; } })();
const linked = new Set<string>();
Object.values(result.featureIssues || {}).flat().forEach(i => i.filedBugs.forEach(b => linked.add(b.id)));
Object.values(result.featureFiledBugs || {}).flat().forEach(b => linked.add(b.id));
(result.otherFiledBugs || []).forEach(b => linked.add(b.id));
console.log(`Filed bugs fetched: ${catalog.length}, linked into report: ${linked.size}, left out: ${catalog.filter((b: any) => !linked.has(b.id)).map((b: any) => b.id).join(', ') || 'none'}`);
console.log(`Wrote ${OUT}/report.txt\n`);
console.log(plainText);
