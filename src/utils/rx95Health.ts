import type { Rx95Heartbeat } from '../services/supabaseService';

/** True when RX95 has stopped answering the worker (2+ failed jobs in a row, none since). */
export const rx95Stalled = (hb?: Rx95Heartbeat): boolean =>
  !!hb?.rx95 && (hb.rx95.failStreak || 0) >= 2 && (!hb.rx95.okAt || (hb.rx95.failAt || '') > hb.rx95.okAt);
