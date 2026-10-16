#!/usr/bin/env node
/**
 * Fake read-only Buganizer CLI for dev / QA runs of the RX95 worker (never talks to Buganizer).
 * Same argv + output shapes as /google/bin/releases/issues-cli/issues for the calls the bridge makes:
 *   readonly search '<query>' --limit N --fields a,b [--page_token T]
 *   readonly render <id> --fields desc
 *   readonly list-updates <id> [--limit N]
 * Data: JSON file at $FAKE_ISSUES_FILE (re-read on every call, so tests can edit it live):
 *   { "issues": [ { "id": "900000001", "title": "...", "status": "NEW", "priority": "P2",
 *       "hotlistIds": ["8682925"], "description": "...", "created": "2026-10-16T18:00:00Z",
 *       "updates": [ { "at": "2026-10-16T18:05:00Z", "by": "me@google.com", "comment": "..." } ] } ] }
 * Query support: hotlistid:N, status:open|fixed|verified|(a|b), "quoted text" (title/description/comments),
 * created>=ISO / created<ISO; anything else is ignored.
 */
import fs from 'node:fs';

const file = process.env.FAKE_ISSUES_FILE;
const data = file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { issues: [] };
const issues = data.issues || [];
const argv = process.argv.slice(2);
if (argv[0] !== 'readonly') { console.error('fake issues CLI: only readonly commands are supported'); process.exit(2); }
const cmd = argv[1];
const flag = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const positional = argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && all[i - 1].startsWith('--')));
const OPEN = new Set(['NEW', 'ASSIGNED', 'ACCEPTED']);

function matches(issue, query) {
  const text = [issue.title, issue.description, ...(issue.updates || []).map(u => u.comment || '')].join('\n').toLowerCase();
  for (const m of query.matchAll(/hotlistid:(\d+)/g)) if (!(issue.hotlistIds || []).includes(m[1])) return false;
  const st = query.match(/status:\(?([a-z|]+)\)?/i);
  if (st) {
    const want = st[1].toLowerCase().split('|');
    const s = String(issue.status || '').toUpperCase();
    if (!want.some(w => (w === 'open' ? OPEN.has(s) : s === w.toUpperCase()))) return false;
  }
  for (const m of query.matchAll(/"([^"]+)"/g)) if (!text.includes(m[1].toLowerCase())) return false;
  const ge = query.match(/created>=(\S+)/); if (ge && !(Date.parse(issue.created) >= Date.parse(ge[1].endsWith('Z') ? ge[1] : ge[1] + 'Z'))) return false;
  const lt = query.match(/created<(\S+)/); if (lt && !(Date.parse(issue.created) < Date.parse(lt[1].endsWith('Z') ? lt[1] : lt[1] + 'Z'))) return false;
  return true;
}

if (cmd === 'search') {
  const query = flag('query') || positional[0] || '';
  const limit = Number(flag('limit') || 10);
  const fields = String(flag('fields') || 'issue_id,title').split(',');
  const start = Number(flag('page_token') || 0);
  const found = issues.filter(i => matches(i, query));
  if (!found.length) { console.log(`No bugs found matching query "${query}"`); process.exit(0); }
  const page = found.slice(start, start + limit);
  console.log(`Showing first ${page.length} issue(s) matching query "${query}":`);
  console.log(page.map(i => {
    const lines = [`Issue ID: ${i.id}`];
    if (fields.includes('status')) lines.push(`Status: ${i.status}`);
    if (fields.includes('priority')) lines.push(`Priority: ${i.priority || 'P2'}`);
    if (fields.includes('title')) lines.push(`Title: ${i.title}`);
    if (fields.includes('created_time')) lines.push('', `Created Time: ${i.created}`);
    return lines.join('\n') + '\n\n';
  }).join('\n---\n\n'));
  if (start + limit < found.length) console.log(`\nNext page token: ${start + limit}`);
} else if (cmd === 'render' || cmd === 'get' || cmd === 'show') {
  const id = flag('issue_id') || positional[0];
  const i = issues.find(x => x.id === String(id));
  if (!i) { console.error(`issue ${id} not found`); process.exit(1); }
  console.log(`Status: ${i.status}\nTitle: ${i.title}\n\nDescription by fake@google.com at ${i.created}:\n${i.description || ''}\n`);
} else if (cmd === 'list-updates') {
  const id = flag('issue_id') || positional[0];
  const i = issues.find(x => x.id === String(id));
  if (!i) { console.error(`issue ${id} not found`); process.exit(1); }
  const ups = [...(i.updates || [])].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, Number(flag('limit') || 25));
  console.log(`Update history for issue ${i.id} (${ups.length + 1} updates):`);
  ups.forEach((u, k) => console.log(`Version ${ups.length - k} by ${u.by || 'fake@google.com'} at ${u.at}:\n  Comment #${ups.length - k}: ${u.comment || ''}`));
  console.log(`Version 0 by fake@google.com at ${i.created}:\n  - title changed`);
} else {
  console.error(`fake issues CLI: unsupported command ${cmd}`);
  process.exit(2);
}
