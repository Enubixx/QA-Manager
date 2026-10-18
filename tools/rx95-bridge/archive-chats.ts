// One-off cleanup: archive existing RX95 refine / repro-match chats (they move to Jetski's "Archived" list).
// Usage (needs ANTIGRAVITY_LS_ADDRESS + ANTIGRAVITY_CSRF_TOKEN in the environment): npx -y tsx tools/rx95-bridge/archive-chats.ts [--dry-run]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { archiveConversation } from './watcher';

const BRAIN = path.join(os.homedir(), '.gemini/jetski/brain');
const dry = process.argv.includes('--dry-run');
const MARKERS = ['── RX95 Bug Refine', '── RX95 Repro Match', '── RX95 Same-day Bundle'];
let found = 0, archived = 0;
for (const id of fs.readdirSync(BRAIN)) {
  const file = path.join(BRAIN, id, '.system_generated/logs/transcript.jsonl');
  if (!fs.existsSync(file)) continue;
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(65536);
  const n = fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  const head = buf.subarray(0, n).toString('utf8');
  if (!MARKERS.some(m => head.includes(m))) continue;
  found++;
  if (!dry && await archiveConversation(id)) archived++;
}
console.log(`RX95 refine/match chats found: ${found}${dry ? ' (dry run)' : `, archived: ${archived}`}`);
