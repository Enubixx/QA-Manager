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
 * Available Gemini Models
 */
export interface GeminiModelOption {
  id: string;
  name: string;
  description: string;
}

export const GEMINI_MODELS: GeminiModelOption[] = [
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (Latest & Recommended)', description: 'Next-gen multimodal speed, high accuracy & reasoning' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro (Deep Reasoning)', description: 'Best for complex, multi-layered defect analysis' },
  { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash-Lite', description: 'Ultra-fast lightweight generation' },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: 'Standard stable production model' },
];

export function getStoredGeminiModel(): string {
  try {
    const saved = localStorage.getItem('qa_gemini_model');
    if (saved && GEMINI_MODELS.some(m => m.id === saved)) return saved;
  } catch (e) {}
  return 'gemini-2.0-flash';
}

export function saveGeminiModel(model: string): void {
  try {
    localStorage.setItem('qa_gemini_model', model);
    summaryCache.clear();
  } catch (e) {}
}

/**
 * Direct native fetch call to Google's Gemini REST API.
 * Ensures 100% browser compatibility without Node SDK or bundler runtime quirks.
 */
async function callGeminiRestApi(
  apiKey: string,
  model: string,
  prompt: string,
  asJson: boolean = false
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const bodyPayload: any = {
    contents: [
      {
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature: 0.2,
    }
  };

  if (asJson) {
    bodyPayload.generationConfig.responseMimeType = 'application/json';
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(bodyPayload)
  });

  if (!response.ok) {
    const errorJson = await response.json().catch(() => null);
    const message = errorJson?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
    throw new Error(message);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('No candidate content returned by Gemini');
  }
  return text;
}

/**
 * Synthesizes raw QA notes into concise, clean issue phrases without dumping raw logs.
 */
export function nlpCleanReword(notes: string[], featureName: string): string {
  if (!notes || notes.length === 0) return '';

  const synthesized = notes.map(note => {
    let text = (note || '').trim();
    // Strip leading time strings like "1.38 pm.", "[10:15 AM]", "14:30 -", "at 2:00 PM,"
    text = text.replace(/^(?:\[?\d{1,2}[:.]\d{2}\s*(?:am|pm)?\]?[:.-]?\s*|at\s+\d{1,2}[:.]\d{2}\s*(?:am|pm)?[:,-]?\s*)/i, '');
    // Strip leading list numbers like "0.", "1.", "0: ", "1: ", "- ", "* "
    text = text.replace(/^(?:\d+[:.]|\*|-|•)\s*/g, '');
    // Remove typical prefixes
    text = text.replace(/^(bug|issue|defect|error|problem|note|encountered|found|description):\s*/i, '');

    // Split into sentences and take only the core descriptive statement
    const segments = text.split(/[.\n;]/).map(s => s.trim()).filter(Boolean);
    let primary = segments[0] || text;

    // Filter out first-person conversational narrative ("I took a photo with...", "did not speak, overheard...")
    primary = primary.replace(/\b(?:I|we)\s+(?:took|tried|noticed|clicked|saw|went|tapped|tested|pressed|was)\b.*$/i, '').trim();
    if (!primary && segments.length > 1) {
      primary = segments[1].trim();
    }
    if (!primary) primary = text;

    // Cap at ~14 words so it stays a summary instead of a word dump
    const words = primary.split(/\s+/);
    if (words.length > 14) {
      primary = words.slice(0, 14).join(' ');
    }

    if (primary.length > 0) {
      primary = primary.charAt(0).toUpperCase() + primary.slice(1);
    }
    return primary.replace(/[,;.]+$/, '').trim();
  }).filter(Boolean);

  const unique = Array.from(new Set(synthesized));
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
    notePart = notePart.replace(/^(?:\d+[:.]|\*|-|•)\s*/g, '');
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
  const selectedModel = getStoredGeminiModel();
  const cacheKey = `${userApiKey}:${selectedModel}:${featureName}:${bugDetailsList.sort().join('||')}`;
  if (summaryCache.has(cacheKey)) {
    return summaryCache.get(cacheKey)!;
  }

  if (userApiKey) {
    try {
      const prompt = `You are a senior Lead QA Engineer distilling test results for executive reporting.

Feature Tested: "${featureName}"
Reported Bugs (Step Title & Description):
${bugDetailsList.join('\n')}

GOAL: Provide a clear, highly accurate, and complete 1-sentence summary (8 to 20 words) explaining the primary bug(s) encountered for this feature.

CRITICAL REQUIREMENTS:
1. ACCURACY & LOGIC FIRST: The summary MUST directly and faithfully reflect the actual reported bugs above. Focus strictly on the core issue, defect, or unexpected behavior. Do NOT include timestamps or conversational artifacts.
2. NEVER TRUNCATE: Write a full, complete sentence. Do not cut off text or use ellipses (...).
3. MAKE COMPLETE SENSE: Ensure the summary is grammatically sound, clear, and makes complete logical sense to a human reader.
4. DOUBLE-CHECK: Before returning, double-check your summary against the reported bugs to verify it is 100% accurate and coherent.
5. Return ONLY the final summary string. Do not add intro text, quotes, prefixes, or markdown bullets.`;

      const responseText = await callGeminiRestApi(userApiKey, selectedModel, prompt, false);
      const text = (responseText || '').trim().replace(/^["']|["']$/g, '');
      if (text) {
        summaryCache.set(cacheKey, text);
        return text;
      }
    } catch (err) {
      console.warn(`Gemini API call failed with model ${selectedModel}:`, err);
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
  const selectedModel = getStoredGeminiModel();
  const cacheKey = `overall:${userApiKey}:${selectedModel}:${bugLines.sort().join('||')}`;
  if (summaryCache.has(cacheKey)) {
    return summaryCache.get(cacheKey)!;
  }

  if (userApiKey) {
    try {
      const prompt = `You are a senior Lead QA Engineer writing an executive summary overview for a QA report.

Reported Bugs List:
${bugLines.join('\n')}

GOAL: Write a concise 1 to 2 sentence executive overview (20 to 40 words) summarizing the key issues and main points of friction reported across the system.

CRITICAL REQUIREMENTS:
1. ACCURACY & REALITY: The summary MUST accurately reflect the actual bugs listed above. Do not invent unrelated errors or fake technical jargon.
2. COMPLETE SENTENCES: Write full, complete, grammatical sentences. Never cut off sentences or end with ellipses (...).
3. SENSE & GRAMMAR: Ensure the summary is grammatically sound, clear, and makes logical sense to a human reader.
4. DOUBLE-CHECK: Review your summary against the bug logs to ensure 100% fidelity and clarity.
5. Return ONLY the final executive summary text.`;

      const responseText = await callGeminiRestApi(userApiKey, selectedModel, prompt, false);
      const text = (responseText || '').trim().replace(/^["']|["']$/g, '');
      if (text) {
        summaryCache.set(cacheKey, text);
        return text;
      }
    } catch (err) {
      console.warn(`Gemini overall summary API call failed with model ${selectedModel}:`, err);
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
  modelUsed?: string;
  error?: string;
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
      text = text.replace(/^(?:\d+[:.]|\*|-|•)\s*/g, '');
      text = text.replace(/^(bug|issue|defect|error|problem|note|encountered|found|description):\s*/i, '');
      const step = b.stepTitle ? ` [Step: ${b.stepTitle}]` : '';
      return `    - ${step} ${text}`;
    }).filter(Boolean);

    return `Feature: "${f.featureName}" (Pass Rate: ${f.healthScorePct}%, Bugs Logged: ${f.bugCount})\n${bugNotes.join('\n')}`;
  }).join('\n\n');

  const userApiKey = getStoredGeminiApiKey();
  const preferredModel = getStoredGeminiModel();
  let lastErrorMessage = '';

  if (userApiKey) {
    // Attempt with selected model first, then fallback to gemini-1.5-flash if needed
    const modelsToTry = [preferredModel];
    if (preferredModel !== 'gemini-2.0-flash') modelsToTry.push('gemini-2.0-flash');
    if (!modelsToTry.includes('gemini-1.5-flash')) modelsToTry.push('gemini-1.5-flash');

    const prompt = `You are a Principal QA Engineer distilling field defect logs to produce a clear, highly accurate executive summary.

TEST EXECUTION DEFECT DATA:
${formattedFeaturesList}

GOAL:
Produce an executive-ready, coherent, accurate, and concise summary of the issues encountered during testing.

CRITICAL INSTRUCTIONS:
1. SUMMARIZE, DO NOT DUMP RAW NOTES: Synthesize and distill the root failure into a clean summary phrase. DO NOT copy-paste long tester logs or conversational dialogue.
2. ACCURACY FIRST: Every summary must accurately reflect the actual bugs described above. Do NOT hallucinate technical errors not reported.
3. COMPLETE CONCISE SENTENCES:
   - "overallSummary": A crisp 1 to 2 sentence executive overview (20 to 35 words) summarizing key problem areas.
   - "featureSummaries": For each feature with bugs, provide a single, crisp, complete sentence (6 to 15 words) explaining the primary defect(s).
4. NEVER TRUNCATE: Do not end sentences with ellipses (...) or cut off text.
5. RETURN FORMAT:
   Return valid JSON with this exact schema:
   {
     "overallSummary": "...",
     "featureSummaries": {
       "Feature Name": "..."
     }
   }
`;

    for (const modelName of modelsToTry) {
      try {
        const text = await callGeminiRestApi(userApiKey, modelName, prompt, true);
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
            featureSummaries: featureMap,
            modelUsed: modelName
          };
        }
      } catch (err: any) {
        lastErrorMessage = err?.message || String(err);
        console.warn(`Gemini batch executive summary call failed with ${modelName}:`, err);
      }
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
    featureSummaries: fallbackFeatureMap,
    error: lastErrorMessage || (!userApiKey ? 'No API Key configured' : undefined)
  };
}
