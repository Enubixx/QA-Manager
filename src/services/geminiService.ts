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
 * Synthesizes raw QA notes into clean, human-readable issue phrases without substituting fake template text.
 */
export function nlpCleanReword(notes: string[], featureName: string): string {
  if (!notes || notes.length === 0) return '';

  const cleaned = notes.map(note => {
    let text = (note || '').trim();
    // Strip leading time strings like "1.38 pm.", "[10:15 AM]", "14:30 -", "at 2:00 PM,"
    text = text.replace(/^(?:\[?\d{1,2}[:.]\d{2}\s*(?:am|pm)?\]?[:.-]?\s*|at\s+\d{1,2}[:.]\d{2}\s*(?:am|pm)?[:,-]?\s*)/i, '');
    // Remove typical prefixes
    text = text.replace(/^(bug|issue|defect|error|problem|note|encountered|found|description):\s*/i, '');
    
    // Capitalize first letter
    if (text.length > 0) {
      text = text.charAt(0).toUpperCase() + text.slice(1);
    }
    
    // Truncate cleanly if note is excessively verbose
    const words = text.split(/\s+/);
    if (words.length > 12) {
      return words.slice(0, 12).join(' ') + '...';
    }
    return text;
  }).filter(Boolean);

  const unique = Array.from(new Set(cleaned));
  if (unique.length === 0) return '';
  if (unique.length === 1) return unique[0];
  return unique.slice(0, 2).join(' & ');
}

/**
 * Summarizes and rewords all reported bugs for a feature into a clear, accurate, and logical executive summary.
 */
export async function summarizeFeatureBugsWithGemini(
  featureName: string,
  bugs: BugLog[] = [],
  yellowCount: number = 0,
  redCount: number = 0
): Promise<string> {
  const bugDetailsList = bugs.map(b => {
    let notePart = (b.note || '').trim();
    notePart = notePart.replace(/^(?:\[?\d{1,2}[:.]\d{2}\s*(?:am|pm)?\]?[:.-]?\s*|at\s+\d{1,2}[:.]\d{2}\s*(?:am|pm)?[:,-]?\s*)/i, '');
    const titlePart = b.stepTitle ? `${b.stepTitle}: ` : '';
    return `- ${titlePart}${notePart}`;
  });

  if (bugDetailsList.length === 0) {
    if (redCount > 0 || yellowCount > 0) {
      const count = redCount + yellowCount;
      return `${count} step failure${count > 1 ? 's' : ''}`;
    }
    return '';
  }

  const userApiKey = getStoredGeminiApiKey();
  const cacheKey = `${userApiKey}:${featureName}:${bugDetailsList.sort().join('||')}`;
  if (summaryCache.has(cacheKey)) {
    return summaryCache.get(cacheKey)!;
  }

  if (userApiKey) {
    try {
      const genAI = new GoogleGenAI({ apiKey: userApiKey });
      const response = await genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `You are a senior Lead QA Engineer distilling test results for executive reporting.

Feature Tested: "${featureName}"
Reported Bugs (Step Title & Description):
${bugDetailsList.join('\n')}

GOAL: Provide a clear, highly accurate, and concise 1-sentence summary (5 to 15 words) explaining the primary bug(s) encountered for this feature.

CRITICAL REQUIREMENTS:
1. ACCURACY & LOGIC FIRST: The summary MUST directly and faithfully reflect the actual reported bugs above. Focus strictly on the core issue, defect, or unexpected behavior. Do NOT include timestamps or conversational artifacts.
2. MAKE COMPLETE SENSE: Ensure the summary is grammatically sound, clear, and makes complete logical sense to a human reader.
3. DOUBLE-CHECK: Before returning, double-check your summary against the reported bugs to verify it is 100% accurate and coherent.
4. Return ONLY the final summary string. Do not add intro text, quotes, prefixes, or markdown bullets.`,
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

  const fallback = nlpCleanReword(bugs.map(b => b.note), featureName);
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

  summarizeFeatureBugsWithGemini(featureName, bugs, yellowCount, redCount);
  return nlpCleanReword(notes, featureName);
}

/**
 * Generates a concise 1-2 sentence executive summary overview of all reported bugs across features using Gemini.
 */
export async function summarizeOverallBugsWithGemini(bugs: BugLog[] = []): Promise<string> {
  if (!bugs || bugs.length === 0) return '';

  const bugLines = bugs.map(b => {
    const feat = b.feature || 'General';
    const step = b.stepTitle ? ` [${b.stepTitle}]` : '';
    const note = b.note ? b.note.trim() : '';
    return `- (${feat}${step}): ${note}`;
  });

  const userApiKey = getStoredGeminiApiKey();
  const cacheKey = `overall:${userApiKey}:${bugLines.sort().join('||')}`;
  if (summaryCache.has(cacheKey)) {
    return summaryCache.get(cacheKey)!;
  }

  if (userApiKey) {
    try {
      const genAI = new GoogleGenAI({ apiKey: userApiKey });
      const response = await genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `You are a senior Lead QA Engineer writing an executive summary overview for a QA report.

Reported Bugs List:
${bugLines.join('\n')}

GOAL: Write a concise 1 to 2 sentence executive overview summarizing the key issues and main points of friction reported across the system.

CRITICAL REQUIREMENTS:
1. ACCURACY & REALITY: The summary MUST accurately reflect the actual bugs listed above. Do not invent unrelated errors or fake technical jargon.
2. SENSE & GRAMMAR: Ensure the summary is grammatically sound, clear, and makes logical sense to a human reader.
3. DOUBLE-CHECK: Review your summary against the bug logs to ensure 100% fidelity and clarity.
4. Return ONLY the final executive summary text.`,
      });

      const text = (response.text || '').trim().replace(/^["']|["']$/g, '');
      if (text) {
        summaryCache.set(cacheKey, text);
        return text;
      }
    } catch (err) {
      console.warn('Gemini overall summary API call failed:', err);
    }
  }

  const notes = bugs.map(b => b.note).filter(Boolean);
  const fallback = notes.length > 0 ? nlpCleanReword(notes, 'Overall') : '';
  summaryCache.set(cacheKey, fallback);
  return fallback;
}

export interface ExecutiveQAResult {
  overallSummary: string;
  featureSummaries: Record<string, string>;
}

export interface FeaturePayload {
  featureName: string;
  status: string;
  healthScorePct: number;
  greenCount: number;
  totalStepsExecuted: number;
  bugCount: number;
  bugs: BugLog[];
}

/**
 * Dedicated subtask that extracts all bugs and their features, prompts Gemini with full context,
 * and returns high-quality, structured executive summaries for both overall session and per feature.
 */
export async function generateBatchExecutiveSummaryWithGemini(
  features: FeaturePayload[],
  allBugs: BugLog[] = []
): Promise<ExecutiveQAResult> {
  const featuresWithBugs = features.filter(f => f.bugCount > 0 || (f.bugs && f.bugs.length > 0));

  if (featuresWithBugs.length === 0 && allBugs.length === 0) {
    return {
      overallSummary: '',
      featureSummaries: {}
    };
  }

  // Format all defect logs cleanly grouped by feature
  const formattedFeaturesList = featuresWithBugs.map(f => {
    const bugNotes = (f.bugs || []).map(b => {
      let text = (b.note || '').trim();
      text = text.replace(/^(?:\[?\d{1,2}[:.]\d{2}\s*(?:am|pm)?\]?[:.-]?\s*|at\s+\d{1,2}[:.]\d{2}\s*(?:am|pm)?[:,-]?\s*)/i, '');
      text = text.replace(/^(bug|issue|defect|error|problem|note|encountered|found|description):\s*/i, '');
      const step = b.stepTitle ? ` [Step: ${b.stepTitle}]` : '';
      return `    - ${step} ${text}`;
    }).filter(Boolean);

    return `Feature: "${f.featureName}" (Pass Rate: ${f.healthScorePct}%, Bugs Logged: ${f.bugCount})\n${bugNotes.join('\n')}`;
  }).join('\n\n');

  const userApiKey = getStoredGeminiApiKey();

  if (userApiKey) {
    try {
      const genAI = new GoogleGenAI({ apiKey: userApiKey });
      const prompt = `You are a Principal QA Engineer distilling field defect logs to produce a clear, highly accurate executive summary.

TEST EXECUTION DEFECT DATA:
${formattedFeaturesList}

GOAL:
Produce an executive-ready, coherent, accurate, and sensible summary of the issues encountered during testing.

CRITICAL INSTRUCTIONS:
1. ACCURACY & SENSE FIRST: Every summary must be 100% faithful to the actual bugs described in the notes above. Do NOT hallucinate technical errors (such as timeouts, payload failures, or token drops) unless they were explicitly reported.
2. NO TIMESTAMPS OR VOICE LOG CHAT: Strip away any timestamps (like "1.38 pm"), tester names, or conversational voice transcripts. Focus purely on the core functional failure or defect.
3. CONCISE & PROFESSIONAL:
   - "overallSummary": A crisp, high-level 1 to 2 sentence executive overview (under 35 words) summarizing the main friction points across the entire test session.
   - "featureSummaries": For each feature with bugs, provide a crisp 1-sentence summary (5 to 15 words) explaining the primary defect(s) for that feature.
4. RETURN FORMAT:
   Return valid JSON with this exact structure:
   {
     "overallSummary": "...",
     "featureSummaries": {
       "Feature Name": "..."
     }
   }
`;

      const response = await genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.2
        }
      });

      const text = (response.text || '').trim();
      if (text) {
        const parsed = JSON.parse(text);
        const overall = typeof parsed.overallSummary === 'string' ? parsed.overallSummary.trim() : '';
        const featureMap: Record<string, string> = {};
        if (parsed.featureSummaries && typeof parsed.featureSummaries === 'object') {
          for (const [k, v] of Object.entries(parsed.featureSummaries)) {
            if (typeof v === 'string') {
              featureMap[k] = v.trim();
            }
          }
        }
        return {
          overallSummary: overall,
          featureSummaries: featureMap
        };
      }
    } catch (err) {
      console.warn('Gemini batch executive summary API call failed:', err);
    }
  }

  // Clean fallback when API key is missing or call fails
  const fallbackFeatureMap: Record<string, string> = {};
  featuresWithBugs.forEach(f => {
    const notes = (f.bugs || []).map(b => b.note).filter(Boolean);
    fallbackFeatureMap[f.featureName] = nlpCleanReword(notes, f.featureName);
  });

  const allNotes = allBugs.map(b => b.note).filter(Boolean);
  const fallbackOverall = allNotes.length > 0 ? nlpCleanReword(allNotes, 'Overall') : '';

  return {
    overallSummary: fallbackOverall,
    featureSummaries: fallbackFeatureMap
  };
}
