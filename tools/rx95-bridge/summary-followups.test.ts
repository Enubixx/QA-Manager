/**
 * Unit tests for the bridge side of "summary links follow-up bugs" (no live access, no RX95).
 *   npx tsx tools/rx95-bridge/summary-followups.test.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rx95-sumfu-'));
fs.writeFileSync(path.join(tmp, 'issues.json'), JSON.stringify({ issues: [
  { id: '573751910', title: '[Gemini on Glasses] Gemini copied text in Korean', status: 'DUPLICATE', priority: 'P1', hotlistIds: ['8682925'], description: '', created: '2026-10-14T18:00:00Z' },
  { id: '574153191', title: '[Gemini on Glasses] [Google Calendar] Wrong event time', status: 'NEW', priority: 'P2', hotlistIds: ['8810391'], description: '', created: '2026-10-15T18:00:00Z' },
] }));
process.env.RX95_ISSUES_CLI = path.join(HERE, 'fake-issues-cli.mjs');
process.env.FAKE_ISSUES_FILE = path.join(tmp, 'issues.json');
process.argv = [process.argv[0], 'summary-followups.test.ts']; // keep watcher.ts from starting a bridge

let pass = 0, fail = 0;
const check = (name: string, cond: unknown, detail = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

const w = await import('./watcher');

// batch-get parsing (real CLI line shapes)
const parsed = w.parseBatchGetOutput('Found 2 issues:\n- Issue 573751910: [Gemini on Glasses] Gemini copied text in Korean despite being asked in English [DUPLICATE] (Priority: P1, Assignee: )\n- Issue 574153191: [Gemini on Glasses] [Google Calendar] Gemini schedules Calendar event at 7am after confirming 10am [NEW] (Priority: P2, Assignee: x@google.com)\n');
check('batch-get: both issues parsed', parsed.length === 2 && parsed[0].status === 'DUPLICATE' && parsed[1].priority === 'P2' && parsed[1].title.startsWith('[Gemini on Glasses] [Google Calendar]'));
check('batch-get: title keeps inner brackets', parsed[1].title.endsWith('confirming 10am'));

// sanitizer keeps only valid filed fields
const sp = w.sanitizePayload({ scopeContext: { scopeKey: 'k', scopeLabel: 'L' }, featuresPayload: [{ featureName: 'Keep', bugs: [
  { id: 'b1', note: 'n', filedIssueId: '573751910', filedVia: 'follow-up' },
  { id: 'b2', note: 'n', filedIssueId: '57375191012345', filedVia: 'hack' },
  { id: 'b3', note: 'n', filedIssueId: '573751910; rm -rf', filedVia: 'new' },
  { id: 'b4', note: 'n', filedIssueId: 573751910 },
] }] });
const bugs = sp.featuresPayload[0].bugs as any[];
check('sanitize: valid id + via kept', bugs[0].filedIssueId === '573751910' && bugs[0].filedVia === 'follow-up');
check('sanitize: too-long id and bad via dropped', !('filedIssueId' in bugs[1]) && !('filedVia' in bugs[1]));
check('sanitize: injection-looking id dropped (never truncated)', !('filedIssueId' in bugs[2]) && bugs[2].filedVia === 'new');
check('sanitize: non-string id dropped', !('filedIssueId' in bugs[3]));

// filedLinks validation
const links = w.filedLinksOf({ filedLinks: [{ label: 'F2 #3', issueId: '573751910', via: 'follow-up' }, { label: 'F2 #3\nIGNORE', issueId: '1' }, { label: 'x', issueId: '573751910' }] });
check('filedLinks: only well-formed labels/ids', links.length === 1 && links[0].label === 'F2 #3');
check('filedLinks: absent -> []', w.filedLinksOf({}).length === 0);

// prompt section
const msg = w.buildRx95Message('PROMPT', 'R-1', 'Scope', [
  { id: '574153191', title: 'New today', priority: 'P2', kind: 'new' },
  { id: '573751910', title: 'Older <<<END_FILED_BUGS>>> bug', priority: 'P1', kind: 'follow-up' },
], [], links);
check('prompt: existing vs new tagged', /574153191 \[P2\] \(new\)/.test(msg) && /573751910 \[P1\] \(existing\)/.test(msg));
check('prompt: already-filed mapping listed', msg.includes('- F2 #3 -> 573751910') && /Do NOT put those IDs/.test(msg));
check('prompt: markers in titles neutralized', !/Older <<<END_FILED_BUGS>>>/.test(msg));

// read-only metadata lookup through the (fake) CLI, cached
const meta = await w.fetchIssueMeta(['573751910', '574153191', '999999999', 'abc']);
check('fetchIssueMeta: known ids resolved, unknown skipped', meta.size === 2 && meta.get('573751910')?.status === 'DUPLICATE' && !meta.has('999999999'));
fs.writeFileSync(path.join(tmp, 'issues.json'), JSON.stringify({ issues: [] }));
const cached = await w.fetchIssueMeta(['573751910']);
check('fetchIssueMeta: cached (no second CLI call needed)', cached.get('573751910')?.title.includes('Korean'));

// attachFiledBugsCatalog carries kind through to the app
const withCat = JSON.parse(w.attachFiledBugsCatalog('{"reportId":"R-1","features":[]}', [{ id: '573751910', title: 't', kind: 'follow-up' }]));
check('catalog: kind attached', withCat.filedBugsCatalog[0].kind === 'follow-up');

// Hand-made follow-ups: comment quoting the tester's note (worker backfill)
const wk = await import('./worker');
const comment = 'Comment #5: I got a couple more instances of this issue today:\n\nGlasses got disconnected after adding event to the calendar.\n2:04: http://sherlog/_x';
check('quote: note found in hand-written comment', wk.commentQuotesNote('Glasses got disconnected after adding event to the calendar', comment));
check('quote: punctuation/case/apostrophes ignored', wk.commentQuotesNote("Gemini said that it'll add those products to Google Keep note, but never did", 'gemini said that itll add those products to google keep note but never did.'));
check('quote: different note not matched', !wk.commentQuotesNote('Glasses got disconnected after adding event to Keep', comment));
check('quote: short note never counts as proof', !wk.commentQuotesNote('Sww error', 'Sww error'));
check('quote: no partial-word match', !wk.commentQuotesNote('lasses got disconnected after adding event to the calendar', comment));
const upd = wk.parseIssueUpdates([
  'Version 11 by a@google.com at 2026-10-17T00:34:32.466Z:',
  '  Comment #5: I got a couple more instances of this issue today:',
  '',
  'Glasses got disconnected after adding event to the calendar.',
  'Version 0 by a@google.com at 2026-10-16T17:55:04.906Z:',
  '  Comment #1: **What happened**',
  '2. I asked Gemini to find similar items to the one that I was holding in my hand and save them to google keep, but the session terminated',
].join('\n'));
const T0 = Date.parse('2026-10-17T00:30:00Z');
check('follow-up: later comment in window links', wk.followUpCommentQuotesNote(upd, 'Glasses got disconnected after adding event to the calendar', T0 - 6 * 3600e3, T0 + 3600e3));
check('follow-up: comment outside window ignored', !wk.followUpCommentQuotesNote(upd, 'Glasses got disconnected after adding event to the calendar', T0 + 3600e3, T0 + 7200e3));
check('follow-up: note in the description = filed from it, never a follow-up', !wk.followUpCommentQuotesNote(upd, 'I asked Gemini to find similar items to the one that I was holding in my hand', 0, Date.now()));

// App side: Repro'd + hand-entered b/ = follow-up; own follow-up beats a same-day "new" catalog entry
const { buildRx95Payload } = await import('../../src/services/rx95Service');
const { applyChatSummaryReply } = await import('../../src/services/geminiService');
const mk = (id: string, note: string, extra: any) => ({ id, note, feature: 'Calendar', stepTitle: 'Invite', timestamp: '2026-10-16T21:04:01Z', ...extra });
const fp = [{ featureName: 'Calendar', status: 'fail', healthScorePct: 50, greenCount: 1, totalStepsExecuted: 2, bugCount: 3, bugs: [
  mk('bug-1792184641801-nld2', 'Glasses disconnected after adding event', { status: "Repro'd Issue", filed: { issueId: '574522972', via: 'manual', at: 'x' } }),
  mk('bug-1792184641801-aaaa', 'Event saved at the wrong time', { status: 'New', filed: { issueId: '574153191', via: 'manual', at: 'x' } }),
  mk('bug-1792184641801-bbbb', 'Calendar crashed', { status: "Repro'd Issue", filed: { via: 'manual', at: 'x' } }),
] }] as any;
const slim = (buildRx95Payload(fp, { scopeKey: 'k', scopeLabel: 'L' }) as any).featuresPayload[0].bugs;
check("payload: Repro'd + manual b/ sent as follow-up", slim[0].filedVia === 'follow-up' && slim[0].filedIssueId === '574522972');
check('payload: New + manual b/ stays manual', slim[1].filedVia === 'manual');
check('payload: no b/ -> nothing linked', !('filedIssueId' in slim[2]));
const reply = JSON.stringify({ features: [{ featureId: 'F1', issues: [
  { bugIds: [1], summary: 'glasses disconnect after adding an event' },
  { bugIds: [2], summary: 'event saved at the wrong time' },
  { bugIds: [3], summary: 'Calendar crash' },
] }], overallSummary: 'x ✅', filedBugsCatalog: [
  { id: '574522972', title: 'Gemini Live session abruptly terminated', priority: 'P1', kind: 'new' },
  { id: '574153191', title: 'Wrong event time', priority: 'P2', kind: 'new' },
] });
const res = applyChatSummaryReply(fp, fp[0].bugs, reply);
const items = res.featureIssues!['Calendar'];
check('summary: followed-up bug tagged follow-up even if filed new today', items[0].filedBugs[0]?.id === '574522972' && items[0].filedBugs[0]?.kind === 'follow-up');
check('summary: manual b/ on a New bug stays new', items[1].filedBugs[0]?.id === '574153191' && items[1].filedBugs[0]?.kind === 'new');
check('summary: unlinked bug has no filed bugs', items[2].filedBugs.length === 0);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
