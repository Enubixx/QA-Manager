import { describe, it, expect } from 'vitest';
import { stageTriage, isTriageDirty, nextTriageBugId } from '../feedTriage';

describe('feed triage staging (① To review Confirm)', () => {
  const current = { bugType: 'Bug', priority: 'P2', status: 'New' };

  it('stages a change without applying it, and un-stages when set back', () => {
    let s = stageTriage(undefined, 'bugType', 'Known Issue', 'Bug');
    expect(s).toEqual({ bugType: 'Known Issue' });
    expect(isTriageDirty(s, current)).toBe(true);
    s = stageTriage(s, 'priority', 'P0', 'P2');
    expect(s).toEqual({ bugType: 'Known Issue', priority: 'P0' });
    s = stageTriage(s, 'bugType', 'Bug', 'Bug');
    expect(s).toEqual({ priority: 'P0' });
    s = stageTriage(s, 'priority', 'P2', 'P2');
    expect(isTriageDirty(s, current)).toBe(false);
  });

  it('nothing staged is not dirty', () => {
    expect(isTriageDirty(undefined, current)).toBe(false);
    expect(isTriageDirty({}, current)).toBe(false);
    expect(isTriageDirty({ status: 'New' }, current)).toBe(false);
  });

  it('picks the next bug in display order, else the previous one', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(nextTriageBugId(ids, 'b')).toBe('c');
    expect(nextTriageBugId(ids, 'd')).toBe('c');
    expect(nextTriageBugId(ids, 'b', id => id === 'c')).toBe('d');
    expect(nextTriageBugId(ids, 'd', id => id !== 'a')).toBe('a');
    expect(nextTriageBugId(['a'], 'a')).toBeNull();
    expect(nextTriageBugId(ids, 'zz')).toBe('a');
  });
});
