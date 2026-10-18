import { describe, it, expect } from 'vitest';
import {
  normalizeIssueId,
  issueUrl,
  newFiled,
  filedStampLine,
} from '../reproFollowUp';
import {
  toWellFormedText,
  safeEncodeURIComponent,
  sliceCodePoints,
  titleFromNote,
  buildBuganizerUrl,
  buildDefaultDraft,
  syncDraftWithBug,
  bugSourceSig,
} from '../buganizerDraft';
import { normalizeHHMM, toLocalHHMM, withBugTime } from '../bugTime';
import { parseRefineReply } from '../bugRefine';
import { shortlistCandidates, parseMatchReply } from '../reproMatch';
import { isPermanentSyncError } from '../../services/offlineSyncQueue';
import { isReviewed, isStronglyReviewed } from '../bugReview';
import { limitNotable } from '../../services/geminiService';
import * as exportUtils from '../exportUtils';
import { APK_DOWNLOAD_URL } from '../../constants';
import type { BugLog } from '../../types';

describe('reproFollowUp.normalizeIssueId & helpers', () => {
  it('normalizes all Buganizer issue URL and shorthand formats', () => {
    expect(normalizeIssueId('b/384918239?comment=5')).toBe('384918239');
    expect(normalizeIssueId('http://b/123#comment2')).toBe('123');
    expect(normalizeIssueId('https://b.corp.google.com/issues/123?pli=1')).toBe('123');
    expect(normalizeIssueId('issuetracker.google.com/issues/456')).toBe('456');
    expect(normalizeIssueId('b/123')).toBe('123');
    expect(normalizeIssueId('123')).toBe('123');
    expect(normalizeIssueId(' b/123 ')).toBe('123');
    expect(normalizeIssueId('')).toBe('');
    expect(normalizeIssueId('junk text with no numbers')).toBe('');
    expect(normalizeIssueId('B/98765')).toBe('98765');
    expect(normalizeIssueId('#comment5')).toBe('');
    expect(normalizeIssueId('?query=123')).toBe('');
    expect(issueUrl('b/384918239?comment=5')).toBe('https://b.corp.google.com/issues/384918239');
    expect(newFiled('manual', 'http://b/123#comment2').issueId).toBe('123');
    expect(filedStampLine(newFiled('manual', 'b/384918239?comment=5'))).toContain('b/384918239');
  });
});

describe('buganizerDraft (emoji-safe, abbreviations, partial drafts, sig ignores time)', () => {
  it('sanitizes lone surrogates and slices by code points without splitting emoji pairs', () => {
    expect(toWellFormedText('prefix\uD83D')).toBe('prefix\uFFFD');
    expect(toWellFormedText('\uDE03suffix')).toBe('\uFFFDsuffix');
    expect(() => safeEncodeURIComponent('hello \uD83D world')).not.toThrow();
    expect(sliceCodePoints('A🔥B', 0, 2)).toBe('A🔥');
    expect(sliceCodePoints('A🔥B', 1, 2)).toBe('🔥');

    const emojiNote = 'A'.repeat(109) + '🔥 extra tail';
    const truncated = titleFromNote(emojiNote);
    expect(truncated).toBe(toWellFormedText(truncated));
  });

  it('does not split sentences on common abbreviations (e.g., i.e., vs.) (B11)', () => {
    expect(titleFromNote('Fails e.g. when tapping touchpad. Second sentence.')).toBe(
      'Fails e.g. when tapping touchpad.'
    );
    expect(titleFromNote('e.g. Gemini stops responding! Next sentence.')).toBe(
      'E.g. Gemini stops responding!'
    );
    expect(titleFromNote('Audio i.e. media playback vs. call audio drops. Fixed after reboot.')).toBe(
      'Audio i.e. media playback vs. call audio drops.'
    );
  });

  it('ignores time changes in bugSourceSig, preserves textEdited:true, fills empty foundIn, and handles partial drafts (B8-B10)', () => {
    const bug1: BugLog = {
      id: 'bug-1',
      testRunId: 'r-1',
      planId: 'p-1',
      stepId: 's-1',
      stepTitle: 'Step 1',
      feature: 'Notifications',
      testerName: 'Alice',
      deviceName: 'WP01',
      title: 'Original title',
      note: 'Original note',
      severity: 'high',
      timestamp: '2026-04-15T10:00:00.000Z',
      formattedTime: '10:00 AM',
    };
    const bug1LaterTime: BugLog = {
      ...bug1,
      timestamp: '2026-04-15T09:30:00.000Z',
      originalTimestamp: '2026-04-15T10:00:00.000Z',
      environment: { glassesFirmware: 'BGH4.260901.003' },
    };
    expect(bugSourceSig(bug1)).toBe(bugSourceSig(bug1LaterTime));

    const draft = buildDefaultDraft(bug1, { cujName: 'Notifications' });
    const handEdited = {
      ...draft,
      title: 'Custom Hand Title',
      description: 'Custom Hand Body',
      textEdited: true,
      foundIn: '',
    };
    const synced = syncDraftWithBug(
      handEdited,
      { ...bug1LaterTime, title: 'New feed title' },
      { cujName: 'Notifications' }
    );
    expect(synced.title).toBe('Custom Hand Title');
    expect(synced.description).toBe('Custom Hand Body');
    expect(synced.foundIn).toBe('BGH4.260901.003');

    const url = buildBuganizerUrl({ bugId: 'b1' } as any);
    expect(url.startsWith('https://b.corp.google.com/issues/new?')).toBe(true);
  });
});

describe('bugTime (9:30 unpadded & future clamp)', () => {
  it('treats "9:30" and "09:30" identically and avoids misleading originalTimestamp on clamped future times (C5, C6)', () => {
    const morningDate = new Date(2026, 9, 17, 9, 30, 15, 0);
    const nowAfternoon = new Date(2026, 9, 17, 14, 0, 0, 0);
    const baseBug: BugLog = {
      id: 'b-1',
      testRunId: 'r-1',
      planId: 'p-1',
      stepId: 's-1',
      stepTitle: 'Step 1',
      feature: 'HUD',
      testerName: 'Alice',
      deviceName: 'WP01',
      severity: 'medium',
      note: 'Flicker',
      timestamp: morningDate.toISOString(),
      formattedTime: '09:30:15 AM',
    };

    expect(normalizeHHMM('9:30')).toBe('09:30');
    expect(normalizeHHMM('09:30')).toBe('09:30');
    expect(withBugTime(baseBug, '9:30', nowAfternoon).originalTimestamp).toBeUndefined();

    const nowMorning = new Date(2026, 9, 17, 9, 30, 20, 0);
    expect(withBugTime(baseBug, '23:59', nowMorning).originalTimestamp).toBeUndefined();

    const adjustedPast = withBugTime(baseBug, '09:15', nowAfternoon);
    expect(adjustedPast.originalTimestamp).toBe(baseBug.timestamp);
    expect(toLocalHHMM(adjustedPast.timestamp)).toBe('09:15');
    expect(withBugTime(adjustedPast, '9:30', nowAfternoon).originalTimestamp).toBeUndefined();
  });
});

describe('bugRefine & reproMatch parsing', () => {
  it('parses fenced JSON containing inner backticks, strips leading brackets before length cap, and matches whole CUJ tokens (B13-B15)', () => {
    const longSuffix = 'A'.repeat(95);
    const replyWithInnerTicks = [
      '```json',
      JSON.stringify({
        reportId: 'RF-1',
        bugs: [
          {
            n: 1,
            title: `[Gemini on Glasses] [Keep] ${longSuffix}`,
            description: 'Crash log:\n```\njava.lang.NullPointerException\n```\nwhen saving note.',
          },
        ],
      }),
      '```',
    ].join('\n');
    const refined = parseRefineReply(replyWithInnerTicks, [{ id: 'b1', title: 'raw', note: 'raw' }]);
    expect(refined.b1).toBeDefined();
    expect(refined.b1.title).toBe(longSuffix);
    expect(refined.b1.title.length).toBe(95);

    const matchReplyWithInnerTicks = [
      '```json',
      JSON.stringify({
        hotlistId: '7908882',
        searched: 10,
        candidatesCatalog: [{ id: '12345678', title: 'Test bug', status: 'NEW', priority: 'P1' }],
        bugs: [
          {
            n: 1,
            matches: [{ id: '12345678', verdict: 'very_likely', confidence: 90, reason: 'Matches ```code``` snippet' }],
          },
        ],
      }),
      '```',
    ].join('\n');
    const parsedMatch = parseMatchReply(matchReplyWithInnerTicks);
    expect(parsedMatch.candidates).toHaveLength(1);
    expect(parsedMatch.candidates[0].id).toBe('12345678');

    const scored = shortlistCandidates(
      { id: 'q1', title: 'zxqwkj', note: '', feature: 'Fluidity', stepTitle: '' },
      [
        { id: '1001', title: '[Gemini on Glasses] [UI] Unrelated candidate one' },
        { id: '1002', title: '[Gemini on Glasses] [Fluidity] Unrelated candidate two' },
      ]
    );
    expect(scored.find(s => s.candidate.id === '1001')!.score).toBe(0);
    expect(scored.find(s => s.candidate.id === '1002')!.score).toBe(0.15);
  });
});

describe('offlineSyncQueue.isPermanentSyncError, bugReview, limitNotable, exportUtils & constants', () => {
  it('classifies missing-column 400 (42703 / PGRST204), 408, 429, 5xx as retryable and other 4xx / 22xxx / 23xxx as permanent', () => {
    expect(isPermanentSyncError({ status: 400, code: '42703' })).toBe(false);
    expect(isPermanentSyncError({ status: 400, code: 'PGRST204' })).toBe(false);
    expect(isPermanentSyncError({ status: 400, code: 'pgrst204' })).toBe(false);
    expect(isPermanentSyncError({ statusCode: 400, code: '42703' })).toBe(false);
    expect(isPermanentSyncError({ statusCode: 400, code: 'PGRST204' })).toBe(false);
    expect(isPermanentSyncError({ status: 400, code: '23505' })).toBe(true);
    expect(isPermanentSyncError({ status: 400, code: '23503' })).toBe(true);
    expect(isPermanentSyncError({ status: 400, code: '22001' })).toBe(true);
    expect(isPermanentSyncError({ status: 400, code: '22P05' })).toBe(true);
    expect(isPermanentSyncError({ status: 400, code: '42P01' })).toBe(true);
    expect(isPermanentSyncError({ status: 400, code: '42601' })).toBe(true);
    expect(isPermanentSyncError({ status: 400, code: '42883' })).toBe(true);
    expect(isPermanentSyncError({ status: 401 })).toBe(true);
    expect(isPermanentSyncError({ status: 403 })).toBe(true);
    expect(isPermanentSyncError({ status: 404 })).toBe(true);
    expect(isPermanentSyncError({ status: 409 })).toBe(true);
    expect(isPermanentSyncError({ status: 422 })).toBe(true);
    expect(isPermanentSyncError({ status: 408 })).toBe(false);
    expect(isPermanentSyncError({ status: 429 })).toBe(false);
    expect(isPermanentSyncError({ status: 500 })).toBe(false);
    expect(isPermanentSyncError({ status: 502 })).toBe(false);
    expect(isPermanentSyncError({ status: 503 })).toBe(false);
    expect(isPermanentSyncError({ status: 504 })).toBe(false);
    expect(isPermanentSyncError({ code: '22P05' })).toBe(true);
    expect(isPermanentSyncError({ code: '23505' })).toBe(true);
    expect(isPermanentSyncError({ code: '42P01' })).toBe(true);
    expect(isPermanentSyncError(new TypeError('fetch failed'))).toBe(false);
    expect(isPermanentSyncError(null)).toBe(false);
    expect(isPermanentSyncError(undefined)).toBe(false);
    expect(isPermanentSyncError({})).toBe(false);
  });

  it('evaluates isReviewed, isStronglyReviewed, limitNotable, exportUtils, and APK_DOWNLOAD_URL (C21, C22, D1, D2, D5)', () => {
    const baseBug: BugLog = {
      id: 'b-1',
      testRunId: 'r-1',
      planId: 'p-1',
      stepId: 's-1',
      stepTitle: 'Step 1',
      feature: 'HUD',
      testerName: 'Alice',
      deviceName: 'WP01',
      severity: 'medium',
      note: 'Flicker',
      timestamp: '2026-10-18T10:00:00.000Z',
      formattedTime: '10:00 AM',
      status: 'New',
      bugType: 'Bug',
      priority: 'P2',
    };
    expect(isReviewed(baseBug)).toBe(false);
    expect(isReviewed(baseBug, { status: 'New' })).toBe(false);
    expect(isReviewed({ ...baseBug, status: "Repro'd Issue" })).toBe(true);
    expect(isStronglyReviewed({ ...baseBug, syncedToSheet: true } as any)).toBe(false);

    const notableText = 'Notably, the display flickered. Notably, the audio also dropped. It was a notable regression.';
    const cleaned = limitNotable(notableText);
    expect((cleaned.match(/notabl[ey]/gi) || []).length).toBe(1);
    expect(cleaned).toContain('The audio also dropped.');

    expect(Object.keys(exportUtils)).toEqual(['exportAllQADataToJSON']);
    expect(APK_DOWNLOAD_URL.startsWith('https://drive.google.com/file/d/15qrnpJExF8siPcuTBy6wTIBk33racp3_')).toBe(true);
  });
});
