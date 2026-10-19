import { describe, expect, it } from 'vitest';
import { rx95Stalled } from '../rx95Health';

const at = '2026-10-19T19:00:00.000Z';
describe('rx95Stalled', () => {
  it('is false without health info (older worker) or with no failures', () => {
    expect(rx95Stalled(undefined)).toBe(false);
    expect(rx95Stalled({ at })).toBe(false);
    expect(rx95Stalled({ at, rx95: { okAt: at, failStreak: 0 } })).toBe(false);
  });
  it('ignores a single failure', () => {
    expect(rx95Stalled({ at, rx95: { okAt: '2026-10-19T18:00:00.000Z', failAt: at, failStreak: 1 } })).toBe(false);
  });
  it('is true after 2+ failures with no success since', () => {
    expect(rx95Stalled({ at, rx95: { okAt: '2026-10-19T18:00:00.000Z', failAt: at, failStreak: 3 } })).toBe(true);
    expect(rx95Stalled({ at, rx95: { failAt: at, failStreak: 2 } })).toBe(true);
  });
  it('clears once a job succeeds again', () => {
    expect(rx95Stalled({ at, rx95: { okAt: '2026-10-19T19:05:00.000Z', failAt: at, failStreak: 0 } })).toBe(false);
  });
});
