// Tone check: seed (sandbox) bugs for one plan -> local RX95 bridge -> app parser. Read-only, no Supabase.
import fs from 'node:fs';
import { applyChatSummaryReply } from '../../src/services/geminiService';
const seed = JSON.parse(fs.readFileSync(new URL('../../public/__local/prototype-seed.json', import.meta.url), 'utf8'));
const planId = process.argv[2] || 'plan-1791908761906';
const by: Record<string, any[]> = {};
for (const b of seed.bugLogs.filter((b: any) => b.planId === planId)) (by[b.feature || 'General'] ??= []).push(b);
const featuresPayload = Object.entries(by).map(([featureName, bugs]) => ({ featureName, status: 'warning', healthScorePct: 75, greenCount: 6, totalStepsExecuted: 8, bugCount: bugs.length, bugs }));
featuresPayload.push({ featureName: 'Text & Spoken Notifications', status: 'healthy', healthScorePct: 96, greenCount: 24, totalStepsExecuted: 25, bugCount: 0, bugs: [] } as any);
const scopeContext = { scopeKey: `tone-test|${planId}|${Date.now()}`, scopeLabel: `seed data for ${planId} [tone test]` };
const r = await fetch('http://127.0.0.1:4799/api/rx95/summary', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ featuresPayload, scopeContext }) });
const { requestId, error } = await r.json(); if (!requestId) throw new Error(error);
let s: any; for (;;) { await new Promise(res => setTimeout(res, 3000)); s = await (await fetch('http://127.0.0.1:4799/api/rx95/summary/' + requestId)).json(); if (s.status === 'done' || s.status === 'error') break; }
if (s.status !== 'done') throw new Error(s.error);
const res = applyChatSummaryReply(featuresPayload as any, featuresPayload.flatMap(f => f.bugs) as any, s.reply, scopeContext);
console.log('OVERALL:', res.overallSummary);
