import type { BugLog } from '../types';
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
});

export function buildRx95Payload(features: FeaturePayload[], scopeContext: SummaryScopeContext) {
  return {
    featuresPayload: features.map(f => ({ ...f, bugs: (f.bugs || []).map(slimBug) })),
    scopeContext: { scopeKey: scopeContext.scopeKey, scopeLabel: scopeContext.scopeLabel },
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
  signal?: { cancelled: boolean }
): Promise<Rx95Result> {
  const payload = buildRx95Payload(features, scopeContext);
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
      if (s?.status === 'done' && s.reply) return { reply: s.reply, conversationId: s.conversationId };
      if (s?.status === 'error') throw new Error(`RX95 couldn't finish the summary: ${s.error}`);
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
    if (data?.status === 'done' && data.reply) return { reply: data.reply, conversationId: data.conversation_id || undefined };
    if (data?.status === 'error') throw new Error(`RX95 couldn't finish the summary: ${data.error}`);
  }
  throw new Error('RX95 did not pick up the request in time. Is your Cloudtop online? You can use AI Chat instead.');
}
