import { GoogleGenAI } from '@google/genai';
import { BugLog } from '../types';

const env = (import.meta as any).env || {};
const apiKey = env.VITE_GEMINI_API_KEY || (typeof process !== 'undefined' ? process.env?.VITE_GEMINI_API_KEY : '') || '';

const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
const summaryCache = new Map<string, string>();

/**
 * Uses Gemini AI to reword and summarize reported bugs into a short 3-6 word status summary.
 * Uses a fast local NLP fallback when Gemini API key is not present.
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

  // Fallback NLP Summarizer
  const fallbackSummary = () => {
    const cleaned = notes.map(n => 
      n.replace(/^(bug|issue|defect|error|problem|encountered|found):\s*/i, '').trim()
    );
    const unique = Array.from(new Set(cleaned));
    if (unique.length === 1) return unique[0];
    return unique.slice(0, 2).join(' & ');
  };

  if (!ai) {
    const res = fallbackSummary();
    summaryCache.set(cacheKey, res);
    return res;
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Summarize these reported bugs for the feature "${featureName}" into a single concise, executive status phrase of 3 to 6 words (e.g. "Gateway timeout on 3G", "Session token loss on restart").
Bugs reported:
${notes.map(n => `- ${n}`).join('\n')}

Return ONLY the brief 3-6 word summary text. Do not add intro text, bullets, or quotation marks.`,
    });

    const text = (response.text || '').trim().replace(/^["']|["']$/g, '');
    const finalResult = text || fallbackSummary();
    summaryCache.set(cacheKey, finalResult);
    return finalResult;
  } catch (err) {
    console.warn('Gemini AI summarization failed, using local NLP fallback:', err);
    const res = fallbackSummary();
    summaryCache.set(cacheKey, res);
    return res;
  }
}

/**
 * Synchronous version for instant UI rendering with fallback, updating cache in background.
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

  // Trigger background Gemini AI fetch
  summarizeFeatureBugsWithGemini(featureName, bugs, yellowCount, redCount);

  // Return immediate local NLP summary
  const cleaned = notes.map(n => 
    n.replace(/^(bug|issue|defect|error|problem|encountered|found):\s*/i, '').trim()
  );
  const unique = Array.from(new Set(cleaned));
  if (unique.length === 1) return unique[0];
  return unique.slice(0, 2).join(' & ');
}
