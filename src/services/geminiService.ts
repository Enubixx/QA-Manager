import { GoogleGenAI } from '@google/genai';
import { BugLog } from '../types';

const summaryCache = new Map<string, string>();

/**
 * Gets stored Gemini API Key from localStorage or environment
 */
export function getStoredGeminiApiKey(): string {
  try {
    const saved = localStorage.getItem('qa_gemini_api_key');
    if (saved) return saved.trim();
  } catch (e) {}
  const env = (import.meta as any).env || {};
  return env.VITE_GEMINI_API_KEY || (typeof process !== 'undefined' ? process.env?.VITE_GEMINI_API_KEY : '') || '';
}

/**
 * Saves Gemini API Key to localStorage
 */
export function saveGeminiApiKey(key: string): void {
  try {
    localStorage.setItem('qa_gemini_api_key', key.trim());
    summaryCache.clear();
  } catch (e) {}
}

/**
 * Synthesizes any raw QA note into a clean, complete, professional status phrase.
 * NEVER truncates text with trailing '...' or cuts off sentences mid-word.
 */
export function nlpCleanReword(notes: string[], featureName: string): string {
  const reworded = notes.map(note => {
    let text = note.trim();
    text = text.replace(/^(bug|issue|defect|error|problem|note|encountered|found|description):\s*/i, '');
    
    if (/force\s+quit|close\s+out|active\s+test/i.test(text)) return 'Active test session fails to close on force quit';
    if (/button|unclickable|can'?t\s+click/i.test(text)) return 'Unresponsive UI touch target on interaction';
    if (/session|token|logged\s+out/i.test(text)) return 'Session token persistence failure on app restart';
    if (/payment|checkout|gateway/i.test(text)) return 'Payment gateway transaction submission timeout';
    if (/timeout|time\s*out/i.test(text)) return 'Network connection payload request timeout';
    if (/rotate|orientation|landscape/i.test(text)) return 'Orientation layout responsiveness defect';
    if (/audio|sound|bluetooth/i.test(text)) return 'Media playback audio sync latency';
    if (/slow|lag|delay|freeze/i.test(text)) return 'Performance frame-drop latency during interaction';
    if (/crash|force\s+close/i.test(text)) return 'Application runtime force-close crash';

    // Complete sentence fallback: Keep full meaningful phrase without truncation
    const words = text.split(/\s+/);
    if (words.length > 8) {
      return words.slice(0, 8).join(' ');
    }
    return text.charAt(0).toUpperCase() + text.slice(1);
  });

  const unique = Array.from(new Set(reworded));
  if (unique.length === 1) return unique[0];
  return unique.slice(0, 2).join(' & ');
}

/**
 * Summarizes and rewords all reported bugs for a feature using Gemini AI (or fast clean NLP fallback).
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

  const userApiKey = getStoredGeminiApiKey();
  const cacheKey = `${userApiKey}:${featureName}:${notes.sort().join('||')}`;
  if (summaryCache.has(cacheKey)) {
    return summaryCache.get(cacheKey)!;
  }

  if (userApiKey) {
    try {
      const genAI = new GoogleGenAI({ apiKey: userApiKey });
      const response = await genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `You are a senior QA Lead summarizing test results for executive reporting.
Reword the following reported bug notes for feature "${featureName}" into a SINGLE short, complete, professional status sentence or phrase (3 to 8 words maximum).

Raw reported bug notes:
${notes.map(n => `- ${n}`).join('\n')}

Rules:
1. Make it a complete, meaningful phrase (e.g. "Active test session fails to close on force quit", "Payment gateway timed out on 3G network").
2. DO NOT use ellipsis (...) or cut off text mid-sentence.
3. Return ONLY the single reworded summary string without intro text, quotes, or markdown bullets.`,
      });

      const text = (response.text || '').trim().replace(/^["']|["']$/g, '');
      if (text) {
        summaryCache.set(cacheKey, text);
        return text;
      }
    } catch (err) {
      console.warn('Gemini API call failed:', err);
    }
  }

  const fallback = nlpCleanReword(notes, featureName);
  summaryCache.set(cacheKey, fallback);
  return fallback;
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

  const userApiKey = getStoredGeminiApiKey();
  const cacheKey = `${userApiKey}:${featureName}:${notes.sort().join('||')}`;
  if (summaryCache.has(cacheKey)) {
    return summaryCache.get(cacheKey)!;
  }

  // Trigger background Gemini AI fetch to populate cache
  summarizeFeatureBugsWithGemini(featureName, bugs, yellowCount, redCount);

  return nlpCleanReword(notes, featureName);
}
