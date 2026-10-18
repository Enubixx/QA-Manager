import type { BugLog, RefinedBugText, ReproMatches } from '../types';
import { REFINE_MAX_BUGS_PER_REQUEST, bugTextSig, parseRefineReply, toRefineInput } from '../utils/bugRefine';
import { parseMatchReply, toMatchInput } from '../utils/reproMatch';
import type { FeaturePayload, SummaryScopeContext } from './geminiService';
import { supabase } from '../lib/supabase';

/**
 * RX95 QA Summary bridge client.
 *
 * Sends ONLY structured bug data (never prompt text) to the RX95 bridge running on the
 * Cloudtop, then waits for RX95's raw JSON reply. The reply is fed into the same
 * applyChatSummaryReply() path as a pasted AI-chat reply, so it is validated the same way.
 *
 * Transport:
 *  - VITE_RX95_BRIDGE_URL set (local testing) -> HTTP bridge, e.g. http://127.0.0.1:4799
 *  - otherwise -> Supabase `ai_summary_requests` table (production)
 */
const env = (import.meta as any).env || {};
const BRIDGE_URL: string = (env.VITE_RX95_BRIDGE_URL || '').replace(/\/$/, '');
const TABLE = 'ai_summary_requests';
export const RX95_TIMEOUT_MS = 240_000;

export const isRx95Available = (): boolean => Boolean(BRIDGE_URL || supabase);

export interface Rx95Result {
  reply: string;
  conversationId?: string;
}

/** Keep only the fields the summary prompt uses - no screenshots or other heavy fields. */
const slimBug = (b: BugLog) => ({
  id: b.id,
  note: b.note,
  stepTitle: b.stepTitle,
  stepId: b.stepId,
  feature: b.feature,
  severity: b.severity,
  testerName: b.testerName,
  deviceName: b.deviceName,
  timestamp: b.timestamp,
  // Filed in Buganizer (confirmed or marked by hand, never pending): the report links that issue to this bug's line.
  // A b/ typed in by hand on a Repro'd bug is the existing bug it was followed up on ("(KI, updated)").
  ...(b.filed?.issueId && /^\d{4,12}$/.test(String(b.filed.issueId))
    ? {
        filedIssueId: String(b.filed.issueId),
        filedVia: (b.filed.via === 'manual' || b.filed.via === 'legacy') && b.status === "Repro'd Issue"
          ? 'follow-up'
          : b.filed.via === 'legacy' ? 'manual' : b.filed.via,
      }
    : {}),
});

/** Which plan and day the report covers - lets the bridge pull that day's Buganizer bugs. */
export interface Rx95ReportScope { planId: string; date: string }

export function buildRx95Payload(features: FeaturePayload[], scopeContext: SummaryScopeContext, reportScope?: Rx95ReportScope) {
  return {
    featuresPayload: features.map(f => ({ ...f, bugs: (f.bugs || []).map(slimBug) })),
    scopeContext: { scopeKey: scopeContext.scopeKey, scopeLabel: scopeContext.scopeLabel },
    ...(reportScope ? { reportScope: { planId: String(reportScope.planId || ''), date: String(reportScope.date || '') } } : {}),
  };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Asks RX95 for the executive summary and resolves with its raw reply text.
 * `onProgress` receives elapsed seconds while waiting. Rejects with a user-facing message.
 */
export async function requestRx95Summary(
  features: FeaturePayload[],
  scopeContext: SummaryScopeContext,
  onProgress?: (elapsedSec: number) => void,
  signal?: { cancelled: boolean },
  reportScope?: Rx95ReportScope
): Promise<Rx95Result> {
  return sendRx95(buildRx95Payload(features, scopeContext, reportScope), onProgress, signal, 'summary');
}

/** Queues any RX95 bridge request (summary or refine) and waits for the raw reply. */
async function sendRx95(
  payload: object,
  onProgress?: (elapsedSec: number) => void,
  signal?: { cancelled: boolean },
  what: 'summary' | 'refine' | 'match' = 'summary'
): Promise<Rx95Result> {
  const started = Date.now();
  const tick = () => onProgress?.(Math.round((Date.now() - started) / 1000));
  if (BRIDGE_URL) {
    const res = await fetch(`${BRIDGE_URL}/api/rx95/summary`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null);
    if (!res) throw new Error("Couldn't reach the RX95 bridge. Is it running on your Cloudtop?");
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.requestId) throw new Error(body.error || `RX95 bridge rejected the request (HTTP ${res.status}).`);
    while (Date.now() - started < RX95_TIMEOUT_MS) {
      if (signal?.cancelled) throw new Error('Cancelled.');
      await sleep(2500);
      tick();
      const s = await fetch(`${BRIDGE_URL}/api/rx95/summary/${body.requestId}`).then(r => r.json()).catch(() => null);
      if (s?.status === 'done') {
        if (typeof s.reply === 'string' && s.reply.trim()) {
          return { reply: s.reply, conversationId: s.conversationId };
        }
        throw new Error(`RX95 returned an empty reply for the ${what}. Try again.`);
      }
      if (s?.status === 'error') throw new Error(`RX95 couldn't finish the ${what}: ${s.error}`);
    }
    throw new Error('RX95 took too long to reply. Try again, or use AI Chat.');
  }

  if (!supabase) throw new Error('RX95 needs the cloud connection (Supabase), which is not configured.');
  const id = `rx95-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { error: insertError } = await supabase.from(TABLE).insert({ id, status: 'pending', payload });
  if (insertError) throw new Error(`Couldn't queue the RX95 request: ${insertError.message}`);
  while (Date.now() - started < RX95_TIMEOUT_MS) {
    if (signal?.cancelled) throw new Error('Cancelled.');
    await sleep(3000);
    tick();
    const { data } = await supabase.from(TABLE).select('status,reply,error,conversation_id').eq('id', id).maybeSingle();
    if (data?.status === 'done') {
      if (typeof data.reply === 'string' && data.reply.trim()) {
        return { reply: data.reply, conversationId: data.conversation_id || undefined };
      }
      throw new Error(`RX95 returned an empty reply for the ${what}. Try again.`);
    }
    if (data?.status === 'error') throw new Error(`RX95 couldn't finish the ${what}: ${data.error}`);
  }
  throw new Error('RX95 did not pick up the request in time. Is your Cloudtop online? You can use AI Chat instead.');
}

/**
 * Asks RX95 to rewrite bugs' title + description into clean Buganizer wording.
 * Resolves with refinements keyed by bug id (bugs RX95 skipped are simply missing).
 */
export async function requestRx95Refine(
  bugs: BugLog[],
  signal?: { cancelled: boolean }
): Promise<Record<string, RefinedBugText>> {
  const batch = bugs.slice(0, REFINE_MAX_BUGS_PER_REQUEST);
  if (batch.length === 0) return {};
  const { reply } = await sendRx95({ kind: 'refine', bugs: batch.map(toRefineInput) }, undefined, signal, 'refine');
  return parseRefineReply(reply, batch);
}

/**
 * Asks RX95 which existing Buganizer bugs (in the plan's hotlist) a "Repro'd Issue" most likely
 * reproduces. The bridge picks the hotlist from its own allowlist; the app only sends the bug and
 * plan id. Resolves with at most 5 candidates (best first, only IDs the bridge shortlisted).
 * Rejects when the plan has no hotlist or the bridge / RX95 fails.
 */
export async function requestRx95Match(
  bug: BugLog,
  planId: string | undefined,
  signal?: { cancelled: boolean }
): Promise<ReproMatches> {
  const plan = String(planId || bug.planId || '');
  if (!/^[\w-]{1,80}$/.test(plan)) throw new Error('This bug has no test plan, so RX95 does not know which hotlist to search.');
  const { reply } = await sendRx95({ kind: 'match', bug: toMatchInput(bug), planId: plan }, undefined, signal, 'match');
  const { meta, candidates } = parseMatchReply(reply);
  if (!meta.hotlistId) throw new Error("RX95's match reply was incomplete (no hotlist). Try again.");
  return { sig: bugTextSig(bug), hotlistId: meta.hotlistId, searched: meta.searched, at: new Date().toISOString(), candidates };
}
