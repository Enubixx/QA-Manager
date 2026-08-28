import { GoogleGenAI } from '@google/genai';
import { BugLog } from '../types';

const env = (import.meta as any).env || {};
const apiKey = env.VITE_GEMINI_API_KEY || (typeof process !== 'undefined' ? process.env?.VITE_GEMINI_API_KEY : '') || '';

const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
const summaryCache = new Map<string, string>();

/**
 * Intelligent Rewording Engine: Transforms informal, raw tester notes into clean,
 * executive 3-6 word status descriptions (e.g. "Button unclickable after rotate" -> "Unresponsive UI target on orientation change").
 */
export function rewordBugNoteToExecutiveStatus(note: string, featureName: string): string {
  let cleaned = note.toLowerCase().trim();
  cleaned = cleaned.replace(/^(bug|issue|defect|error|problem|note|encountered|found):\s*/i, '');

  const rules: [RegExp, string][] = [
    [/button\s+unclickable|can'?t\s+click|button\s+not\s+working|unclickable/i, 'Unresponsive UI touch target'],
    [/session\s+token|token\s+lost|token\s+expired|logged\s+out/i, 'Session token persistence failure'],
    [/force\s+quit|app\s+crashed|crashed|force\s+close|crash/i, 'Application runtime crash'],
    [/black\s+screen|blank\s+screen|screen\s+went\s+black/i, 'Display render black-screen glitch'],
    [/rotate|orientation|landscape|portrait/i, 'Orientation layout responsiveness defect'],
    [/payment|checkout|gateway|stripe/i, 'Payment gateway transaction failure'],
    [/timeout|time\s*out|timed\s*out/i, 'Network payload connection timeout'],
    [/audio|sound|bluetooth|headset|speaker|latency/i, 'Media playback audio sync latency'],
    [/slow|lag|delay|freeze|sluggish|perf/i, 'Performance frame-drop latency'],
    [/api|fetch|server\s+error|500|404/i, 'API service endpoint failure'],
    [/cart|total|calculation|price|amount/i, 'Cart total calculation discrepancy'],
    [/login|auth|password|credentials/i, 'Authentication credential defect'],
    [/validation|email|input|field/i, 'Form input validation defect']
  ];

  for (const [pattern, replacement] of rules) {
    if (pattern.test(cleaned)) {
      return replacement;
    }
  }

  // NLP synthesis fallback: Capitalize key action words into a clean phrase
  const words = cleaned.split(/\s+/).filter(w => w.length > 2 && !['the', 'and', 'for', 'with', 'when', 'that', 'this'].includes(w));
  if (words.length === 0) return `${featureName} defect`;
  const shortPhrase = words.slice(0, 4).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return `${shortPhrase} defect`;
}

/**
 * Summarizes and rewords all reported bugs for a feature using Gemini AI (or fast NLP rewriter).
 */
export async function summarizeFeatureBugsWithGemini(
  featureName: string,
  bugs: BugLog[] = [],
  yellowCount: number = 0,
  redCount: number = 0
): Promise<string> {
  const notes = bugs
    .map(b => b.note?.trim())
    .filter((n): n is string => !!n && n.length > 0);

  if (notes.length === 0) {
    if (redCount > 0 || yellowCount > 0) {
      const count = redCount + yellowCount;
      return `${count} step failure${count > 1 ? 's' : ''}`;
    }
    return '';
  }

  const cacheKey = `${featureName}:${notes.sort().join('||')}`;
  if (summaryCache.has(cacheKey)) {
    return summaryCache.get(cacheKey)!;
  }

  // Intelligent Local NLP Rewriter
  const nlpRewordedSummary = () => {
    const rewordedList = notes.map(n => rewordBugNoteToExecutiveStatus(n, featureName));
    const unique = Array.from(new Set(rewordedList));
    if (unique.length === 1) return unique[0];
    return unique.slice(0, 2).join(' & ');
  };

  if (!ai) {
    const res = nlpRewordedSummary();
    summaryCache.set(cacheKey, res);
    return res;
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `You are a senior QA Lead. Reword and synthesize the following informal QA tester bug notes for feature "${featureName}" into a SINGLE executive 3 to 6 word status summary (e.g. "Unresponsive UI target on orientation change", "Session token persistence failure", "Payment gateway connection timeout").

Raw reported bug notes:
${notes.map(n => `- ${n}`).join('\n')}

Return ONLY the single reworded 3-6 word summary string. Do not use quotes, intro text, or extra words.`,
    });

    const text = (response.text || '').trim().replace(/^["']|["']$/g, '');
    const finalResult = text || nlpRewordedSummary();
    summaryCache.set(cacheKey, finalResult);
    return finalResult;
  } catch (err) {
    console.warn('Gemini AI summarization failed, using local NLP rewriter:', err);
    const res = nlpRewordedSummary();
    summaryCache.set(cacheKey, res);
    return res;
  }
}

/**
 * Synchronous reworded summary for instant UI rendering.
 */
export function getBriefIssueSummarySync(
  featureName: string,
  bugs: BugLog[] = [],
  yellowCount: number = 0,
  redCount: number = 0
): string {
  const notes = bugs
    .map(b => b.note?.trim())
    .filter((n): n is string => !!n && n.length > 0);

  if (notes.length === 0) {
    if (redCount > 0 || yellowCount > 0) {
      const count = redCount + yellowCount;
      return `${count} step failure${count > 1 ? 's' : ''}`;
    }
    return '';
  }

  const cacheKey = `${featureName}:${notes.sort().join('||')}`;
  if (summaryCache.has(cacheKey)) {
    return summaryCache.get(cacheKey)!;
  }

  // Trigger background Gemini AI fetch to replace cache when ready
  summarizeFeatureBugsWithGemini(featureName, bugs, yellowCount, redCount);

  // Return immediate local NLP reworded summary
  const rewordedList = notes.map(n => rewordBugNoteToExecutiveStatus(n, featureName));
  const unique = Array.from(new Set(rewordedList));
  if (unique.length === 1) return unique[0];
  return unique.slice(0, 2).join(' & ');
}
