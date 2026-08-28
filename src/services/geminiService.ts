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
 * Ensures 100% browser compatibility, handles 'models/' prefix, and falls back between v1beta and v1 endpoints.
 */
async function callGeminiRestApi(
  apiKey: string,
  model: string,
  prompt: string,
  asJson: boolean = false
): Promise<string> {
  const cleanModel = model.replace(/^models\//, '').trim();
  const key = apiKey.trim();
  const endpoints = [
    `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${key}`,
    `https://generativelanguage.googleapis.com/v1/models/${cleanModel}:generateContent?key=${key}`
  ];

  let lastError = '';

  for (const url of endpoints) {
    try {
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
          'x-goog-api-key': key
        },
        body: JSON.stringify(bodyPayload)
      });

      if (response.ok) {
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return text;
      } else {
        const errorJson = await response.json().catch(() => null);
        lastError = errorJson?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
        // If 404 (model not found on this specific API version), try the other endpoint
        if (response.status === 404) {
          continue;
        }
        // If auth or invalid key error, fail fast
        throw new Error(lastError);
      }
    } catch (err: any) {
      if (err.message?.includes('API key') || err.message?.includes('PERMISSION_DENIED')) {
        throw err;
      }
      lastError = err?.message || String(err);
    }
  }

  throw new Error(lastError || `Model ${cleanModel} could not be resolved`);
}

/**
 * Discovers available models for a given Google Gemini API Key via ModelService.ListModels.
 */
export async function discoverAvailableGeminiModels(
  apiKey: string
): Promise<{ success: boolean; models: string[]; error?: string }> {
  if (!apiKey || !apiKey.trim()) {
    return { success: false, models: [], error: 'API key is empty' };
  }

  const key = apiKey.trim();
  const endpoints = [
    `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
    `https://generativelanguage.googleapis.com/v1/models?key=${key}`
  ];

  let lastError = '';

  for (const url of endpoints) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.models && Array.isArray(data.models)) {
          const supported = data.models
            .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
            .map((m: any) => m.name.replace(/^models\//, ''));
          if (supported.length > 0) {
            return { success: true, models: supported };
          }
        }
      } else {
        const errData = await response.json().catch(() => null);
        lastError = errData?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
      }
    } catch (err: any) {
      lastError = err?.message || String(err);
    }
  }

  return { success: false, models: [], error: lastError || 'No supported models found for this API key' };
}

/**
 * Cleans leading timestamps, bullet markers, and conversational clutter from raw note text.
 */
export function cleanRawNote(raw: string): string {
  let text = (raw || '').trim();
  // Strip timestamps like "[10:15 AM]", "1.38 pm.", "at 2:00 PM,", "14:30 -"
  text = text.replace(/^(?:\[?\d{1,2}[:.]\d{2}\s*(?:am|pm)?\]?[:.-]?\s*|at\s+\d{1,2}[:.]\d{2}\s*(?:am|pm)?[:,-]?\s*)/i, '');
  // Strip list markers like "0.", "1.", "0: ", "- ", "* ", "• "
  text = text.replace(/^(?:\d+[:.]|\*|-|•)\s*/g, '');
  // Strip prefixes like "bug:", "issue:", "defect:", "note:", "encountered:", "found:"
  text = text.replace(/^(?:bug|issue|defect|error|problem|note|encountered|found|description):\s*/i, '');
  return text.trim();
}

/**
 * Extracts normalized duration string (e.g. "4 minutes", "15 seconds", "500 ms").
 */
export function extractNormalizedDuration(text: string): string | null {
  const match = text.match(/(?:exceeding|over|took|more than|greater than|delay of|delayed by|lagged for|hangs? for)?\s*(\d+(?:\.\d+)?)\s*(minutes?|mins?|seconds?|secs?|ms|milliseconds?|hours?|hrs?)\b/i);
  if (!match) return null;
  const num = match[1];
  let unit = match[2].toLowerCase();
  if (unit.startsWith('min')) unit = Number(num) === 1 ? 'minute' : 'minutes';
  else if (unit.startsWith('sec') || unit === 's') unit = Number(num) === 1 ? 'second' : 'seconds';
  else if (unit.startsWith('hr') || unit.startsWith('hour')) unit = Number(num) === 1 ? 'hour' : 'hours';
  else if (unit.startsWith('ms') || unit.startsWith('milli')) unit = 'ms';
  return `${num} ${unit}`;
}

/**
 * Intelligent pattern detection for individual QA defect notes.
 * Distills root failure mechanics into concise, executive-grade engineering phrases.
 */
export function extractIntelligentDefectPattern(note: string, featureContext: string = ''): string {
  const text = cleanRawNote(note);
  if (!text) return '';
  const lower = text.toLowerCase();
  const contextLower = (featureContext || '').toLowerCase();
  const combinedContext = `${contextLower} ${lower}`;
  const duration = extractNormalizedDuration(text);

  // 1. Latency / Delay / Timeout patterns
  const isLatency = /\b(?:latency|delay|delayed|slow|lag|lagged|took|exceeding|timed? out|timeout|wait|hangs for)\b/i.test(lower) || !!duration;
  if (isLatency) {
    const isConsecutive = /\b(?:consecutive|back-to-back|repeated|sequential|multiple)\s*requests?\b/i.test(lower);
    const consecutiveSuffix = isConsecutive ? ' during consecutive requests' : '';

    if (/\b(?:image|photo|stylized|render|generat)/i.test(combinedContext)) {
      if (duration) {
        return `Image generation latency exceeding ${duration}${consecutiveSuffix}`;
      }
      return `Image generation latency${consecutiveSuffix}`;
    }

    if (/\b(?:voice|audio|speech|assistant|sound|playback|spoken)\b/i.test(combinedContext)) {
      if (duration) {
        return `Audio response latency exceeding ${duration}`;
      }
      return `Audio playback latency`;
    }

    if (/\b(?:ui|screen|navigation|load|page|view|render|transition)\b/i.test(combinedContext)) {
      if (duration) {
        return `UI rendering latency exceeding ${duration}`;
      }
      return `UI response latency during navigation`;
    }

    if (/\b(?:network|api|server|request|backend|fetch)\b/i.test(combinedContext)) {
      if (duration) {
        return `Network request latency exceeding ${duration}`;
      }
      return `Network request latency`;
    }

    if (duration) {
      return `Processing latency exceeding ${duration}${consecutiveSuffix}`;
    }
  }

  // 2. False / Unprompted Triggers & Spontaneous Activations
  const isFalseTrigger = /\b(?:unprompted|spontaneous|spontaneously|false[\s-]trigger|falsely\s*activat|false\s*activat|ambient|overheard|background\s*(?:speech|noise|voice|tv|sound)|phantom|without\s*(?:pressing|clicking|prompt|trigger|input|touching))\b/i.test(lower);
  if (isFalseTrigger) {
    if (/\b(?:photo|camera|capture|picture|shutter|lens)\b/i.test(combinedContext)) {
      return 'spontaneous unprompted photo capture';
    }

    if (/\b(?:voice|audio|assistant|hotword|speech|command|listening)\b/i.test(combinedContext)) {
      if (/\b(?:ambient|overheard|background|tv|noise|conversation)\b/i.test(lower)) {
        return 'false voice-trigger activations from ambient background speech';
      }
      return 'false voice-trigger activations';
    }

    if (/\b(?:sensor|gesture|motion|proximity)\b/i.test(combinedContext)) {
      return 'unprompted sensor activation';
    }

    return 'spontaneous unprompted trigger activation';
  }

  // 3. Duplicate Feedback / Duplicate Responses
  const isDuplicate = /\b(?:duplicate|twice|repeated|repeating|two times|double|spoke twice|echoed)\b/i.test(lower);
  if (isDuplicate) {
    if (/\b(?:voice|speech|confirmation|spoke|assistant|audio|feedback|announcement)\b/i.test(combinedContext)) {
      if (/\b(?:event|calendar|task|meeting|reminder|entry|creation|created|upon|add(?:ed)?)\b/i.test(lower)) {
        return 'Duplicate voice confirmation feedback upon event creation';
      }
      return 'Duplicate voice confirmation feedback';
    }

    if (/\b(?:notification|alert|message|banner)\b/i.test(combinedContext)) {
      return 'Duplicate notification dispatch';
    }

    if (/\b(?:item|entry|card|record|transaction)\b/i.test(combinedContext)) {
      return 'Duplicate entry creation';
    }

    return 'Duplicate response feedback';
  }

  // 4. UI Freezing / Unresponsiveness
  if (/\b(?:freeze|frozen|freezing|unresponsive|not\s*responding|hang|hangs|hanging|stuck|lockup|locked\s*up)\b/i.test(lower)) {
    if (duration) {
      return `UI unresponsiveness and ${duration} freeze`;
    }
    if (/\b(?:navigation|transition|settings|menu|scroll)\b/i.test(lower)) {
      return 'UI unresponsiveness during navigation';
    }
    return 'UI freezing and unresponsiveness';
  }

  // 5. Crashes / Process Abort
  if (/\b(?:crash|crashed|crashes|crashing|force\s*close|fatal|exception|abort)\b/i.test(lower)) {
    if (/\b(?:launch|start|open|init)\b/i.test(lower)) {
      return 'Application crash upon launch';
    }
    if (/\b(?:background|resume|switch)\b/i.test(lower)) {
      return 'Application crash during background transition';
    }
    return 'Application crash during execution';
  }

  // 6. Audio Dropout / Distortion / Clipping
  if (/\b(?:audio\s*cut|audio\s*drop|no\s*sound|mute|silent|clipping|crackl|distortion|stutter)\b/i.test(lower)) {
    return 'Audio playback dropouts and distortion';
  }

  // 7. Speech Recognition / Transcription Inaccuracies
  if (/\b(?:transcription|transcribe|recognition|misheard|failed\s*to\s*(?:recognize|hear|understand)|inaccurate\s*(?:speech|transcription))\b/i.test(lower)) {
    if (/\b(?:ambient|noise|background)\b/i.test(lower)) {
      return 'Speech recognition inaccuracies under ambient noise';
    }
    return 'Speech transcription recognition errors';
  }

  // 8. Bluetooth / Connectivity / Sync Failures
  if (/\b(?:bluetooth|disconnect|connection\s*lost|failed\s*to\s*connect|offline|sync\s*fail|synchronization)\b/i.test(lower)) {
    return 'Intermittent Bluetooth disconnection and synchronization failure';
  }

  // 9. Rendering / Blank Display
  if (/\b(?:blank\s*screen|white\s*screen|black\s*screen|flicker|render|glitch|visual\s*artifact)\b/i.test(lower)) {
    return 'UI rendering defect resulting in blank display';
  }

  // General fallback: clean conversational narrative while keeping essential core
  let cleaned = text
    .replace(/\b(?:I|we)\s+(?:took|tried|noticed|clicked|saw|went|tapped|tested|pressed|was|observed)\b/gi, '')
    .replace(/^(?:the\s+)?(?:user\s+)?(?:noticed|observed|reported)\s+that\s+/i, '')
    .trim();

  // Remove trailing period or comma
  cleaned = cleaned.replace(/[,;.]+$/, '').trim();

  // Limit word count to keep crisp
  const words = cleaned.split(/\s+/);
  if (words.length > 14) {
    cleaned = words.slice(0, 14).join(' ');
  }

  if (!cleaned) cleaned = text;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Generates an executive-level synthesized overview matching the requested tone and structure:
 * "Testing revealed latency and false-trigger issues across voice and camera flows, primarily characterized by
 * image generation delays exceeding 4 minutes, unprompted photo captures, and duplicate confirmation speech triggered by overheard ambient voices."
 */
export function synthesizeExecutiveOverview(notes: string[], featureNames: string[] = []): string {
  if (!notes || notes.length === 0) return '';

  const allText = notes.join(' ');
  const lower = allText.toLowerCase();

  // 1. Detect Defect Categories
  const categories: string[] = [];
  const hasLatency = /\b(?:latency|delay|delayed|slow|lag|exceeding|timeout|took)\b/i.test(lower);
  const hasFalseTrigger = /\b(?:unprompted|spontaneous|false[\s-]trigger|falsely\s*activat|ambient|overheard)\b/i.test(lower);
  const hasDuplicate = /\b(?:duplicate|twice|repeated|double|echoed)\b/i.test(lower);
  const hasStability = /\b(?:freeze|frozen|unresponsive|hang|crash|crashed|force\s*close)\b/i.test(lower);
  const hasAudio = /\b(?:audio\s*cut|no\s*sound|clipping|distortion|stutter)\b/i.test(lower);
  const hasConnectivity = /\b(?:bluetooth|disconnect|connection\s*lost|sync\s*fail)\b/i.test(lower);

  if (hasLatency) categories.push('latency');
  if (hasFalseTrigger) categories.push('false-trigger');
  if (hasDuplicate && !categories.includes('false-trigger')) categories.push('duplicate-response');
  if (hasStability) categories.push('stability');
  if (hasAudio && !categories.includes('latency')) categories.push('audio playback');
  if (hasConnectivity) categories.push('connectivity');

  let categoryStr = 'functional defect';
  if (categories.length === 1) {
    categoryStr = categories[0];
  } else if (categories.length >= 2) {
    categoryStr = `${categories[0]} and ${categories[1]}`;
  }

  // 2. Detect System / Feature Flows
  const allFlows = featureNames.map(f => f.toLowerCase()).concat([lower]).join(' ');
  const flows: string[] = [];
  if (/\b(?:voice|audio|assistant|speech)\b/i.test(allFlows)) flows.push('voice');
  if (/\b(?:camera|vision|photo|image)\b/i.test(allFlows)) flows.push('camera');
  if (/\b(?:navigation|settings|ui)\b/i.test(allFlows)) flows.push('navigation');
  if (/\b(?:bluetooth|connectivity|sync)\b/i.test(allFlows)) flows.push('connectivity');

  // If specific featureNames are present but didn't match keyword list
  if (flows.length === 0 && featureNames.length > 0) {
    const cleanNames = featureNames.slice(0, 2).map(n => n.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim());
    flows.push(...cleanNames);
  }

  let flowStr = 'core application flows';
  if (flows.length === 1) {
    flowStr = `${flows[0]} flows`;
  } else if (flows.length >= 2) {
    flowStr = `${flows[0]} and ${flows[1]} flows`;
  }

  // 3. Extract Specific Highlights
  const highlights: string[] = [];

  // Check image generation delay
  if (/\b(?:image|photo|stylized|render).*(?:exceeding|over|took|more than|delay).*(\d+(?:\.\d+)?\s*(?:minutes?|mins?|seconds?|secs?))/i.test(lower) ||
      (/\b(?:image|photo)\b/i.test(lower) && hasLatency)) {
    const dur = extractNormalizedDuration(allText);
    highlights.push(dur ? `image generation delays exceeding ${dur}` : 'image generation delays during consecutive requests');
  }

  // Check unprompted photo captures
  if (/\b(?:photo|camera|picture|shutter)\b/i.test(lower) && /\b(?:unprompted|spontaneous|without\s*pressing)\b/i.test(lower)) {
    highlights.push('unprompted photo captures');
  }

  // Check duplicate confirmation speech / ambient voices
  if (/\b(?:duplicate|twice)\b/i.test(lower) && /\b(?:voice|speech|confirmation|spoke)\b/i.test(lower) && /\b(?:ambient|overheard|background)\b/i.test(lower)) {
    highlights.push('duplicate confirmation speech triggered by overheard ambient voices');
  } else {
    if (/\b(?:duplicate|twice)\b/i.test(lower) && /\b(?:voice|speech|confirmation|spoke)\b/i.test(lower)) {
      highlights.push('duplicate confirmation speech feedback');
    }
    if (/\b(?:ambient|overheard|background)\b/i.test(lower) && /\b(?:voice|audio|assistant)\b/i.test(lower)) {
      highlights.push('false voice-trigger activations from ambient background speech');
    }
  }

  // Check freezing / UI unresponsiveness
  if (hasStability && highlights.length < 3) {
    const dur = extractNormalizedDuration(allText);
    highlights.push(dur ? `UI freezes exceeding ${dur}` : 'intermittent UI unresponsiveness');
  }

  // Check audio dropouts
  if (hasAudio && highlights.length < 3) {
    highlights.push('audio playback dropouts and distortion');
  }

  // Check bluetooth disconnection
  if (hasConnectivity && highlights.length < 3) {
    highlights.push('intermittent Bluetooth disconnections');
  }

  // If no highlights matched rule-based conditions, extract from top notes using pattern extractor
  if (highlights.length === 0) {
    for (const note of notes.slice(0, 3)) {
      const p = extractIntelligentDefectPattern(note, '');
      if (p) {
        highlights.push(p.charAt(0).toLowerCase() + p.slice(1).replace(/[.]+$/, ''));
      }
    }
  }

  let highlightStr = 'intermittent functional regressions';
  if (highlights.length === 1) {
    highlightStr = highlights[0];
  } else if (highlights.length === 2) {
    highlightStr = `${highlights[0]} and ${highlights[1]}`;
  } else if (highlights.length >= 3) {
    highlightStr = `${highlights[0]}, ${highlights[1]}, and ${highlights[2]}`;
  }

  return `Testing revealed ${categoryStr} issues across ${flowStr}, primarily characterized by ${highlightStr}.`;
}

/**
 * Synthesizes raw QA notes into concise, clean executive defect phrases.
 * Supports intelligent pattern detection for latency, duplicate feedback, false triggers, etc.
 */
export function nlpCleanReword(notes: string[], featureName: string): string {
  if (!notes || notes.length === 0) return '';

  if (featureName.toLowerCase() === 'overall') {
    return synthesizeExecutiveOverview(notes, []);
  }

  const synthesized: string[] = [];
  for (const note of notes) {
    const pattern = extractIntelligentDefectPattern(note, featureName);
    if (pattern && !synthesized.some(s => s.toLowerCase() === pattern.toLowerCase())) {
      synthesized.push(pattern);
    }
  }

  if (synthesized.length === 0) return '';

  if (synthesized.length === 1) {
    let single = synthesized[0].trim();
    single = single.charAt(0).toUpperCase() + single.slice(1);
    if (!single.endsWith('.')) single += '.';
    return single;
  }

  // Connect two primary defect phrases with "and"
  let first = synthesized[0].trim();
  first = first.charAt(0).toUpperCase() + first.slice(1);
  first = first.replace(/[.,;]+$/, '');

  let second = synthesized[1].trim();
  second = second.charAt(0).toLowerCase() + second.slice(1);
  second = second.replace(/[.,;]+$/, '');

  return `${first} and ${second}.`;
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
      const prompt = `You are a Senior Principal QA Architect distilling test results for executive reporting.

Feature Tested: "${featureName}"
Reported Bugs (Step Title & Description):
${bugDetailsList.join('\n')}

GOAL: Provide an executive-level, clear, and complete 1-sentence synthesis (8 to 22 words) explaining the primary defect(s) encountered for this feature.

FEW-SHOT EXAMPLES:
- "Image generation latency exceeding 4 minutes during consecutive requests and spontaneous unprompted photo capture."
- "Duplicate voice confirmation feedback upon event creation and false voice-trigger activations from ambient background speech."

CRITICAL REQUIREMENTS:
1. EXECUTIVE SYNTHESIS: Focus strictly on the core failure mechanisms using precise engineering terminology (e.g. latency, duplicate feedback, unprompted triggers). Do NOT include timestamps or conversational artifacts.
2. PRESERVE METRICS: Retain specific quantitative thresholds (e.g. durations like "exceeding 4 minutes").
3. NEVER TRUNCATE: Write a full, complete sentence ending with a period. Do not cut off text or use ellipses (...).
4. Return ONLY the final summary string. Do not add intro text, quotes, prefixes, or markdown bullets.`;

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
      const prompt = `You are a Senior Principal QA Architect writing an executive summary overview for an engineering leadership report.

Reported Bugs List:
${bugLines.join('\n')}

GOAL: Write a concise 1 to 2 sentence executive overview (20 to 45 words) synthesizing key failure modes and friction areas across the system.

FEW-SHOT EXAMPLE:
"Testing revealed latency and false-trigger issues across voice and camera flows, primarily characterized by image generation delays exceeding 4 minutes, unprompted photo captures, and duplicate confirmation speech triggered by overheard ambient voices."

CRITICAL REQUIREMENTS:
1. EXECUTIVE SYNTHESIS: Frame the overview strategically: "Testing revealed [key defect categories, e.g. latency, false-trigger, stability] issues across [affected feature/system flows], primarily characterized by [synthesized root causes with exact durations/metrics retained]..."
2. PRESERVE METRICS: Retain specific quantitative thresholds (e.g. durations like "exceeding 4 minutes").
3. ACCURACY & REALITY: The summary MUST accurately reflect the actual bugs listed above without hallucinating unrelated errors.
4. COMPLETE SENTENCES: Write full, complete, grammatical sentences. Never cut off sentences or end with ellipses (...).
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
  const featureNames = Array.from(new Set(bugs.map(b => b.feature).filter(Boolean))) as string[];
  const fallback = notes.length > 0 ? synthesizeExecutiveOverview(notes, featureNames) : '';
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
    // Attempt with selected model first, then fallback to other standard models
    const modelsToTry = [preferredModel];
    if (!modelsToTry.includes('gemini-2.0-flash')) modelsToTry.push('gemini-2.0-flash');
    if (!modelsToTry.includes('gemini-1.5-flash-latest')) modelsToTry.push('gemini-1.5-flash-latest');
    if (!modelsToTry.includes('gemini-1.5-flash')) modelsToTry.push('gemini-1.5-flash');
    if (!modelsToTry.includes('gemini-1.5-pro')) modelsToTry.push('gemini-1.5-pro');

    const prompt = `You are a Senior Principal QA Architect distilling field defect logs to produce a high-impact executive summary report for engineering leadership.

TEST EXECUTION DEFECT DATA:
${formattedFeaturesList}

GOAL:
Produce an executive-ready, highly synthesized, accurate, and concise summary of the issues encountered during testing matching the tone and precision of the few-shot examples below.

FEW-SHOT EXAMPLES OF EXPECTED SYNTHESIS & TONE:

Example Input:
Feature: "Camera & Vision" (Pass Rate: 60%, Bugs Logged: 2)
    - [Step: Capture photo] Spontaneous photo capture occurred without pressing trigger or shutter button.
    - [Step: Generate stylized image] Took over 4 minutes to generate image when sending consecutive requests.

Feature: "Voice Assistant & Audio" (Pass Rate: 75%, Bugs Logged: 2)
    - [Step: Create event via voice] Assistant provided duplicate voice confirmation feedback upon event creation.
    - [Step: Passive listening] Overheard ambient conversation from background TV and falsely activated voice command.

Expected JSON Output:
{
  "overallSummary": "Testing revealed latency and false-trigger issues across voice and camera flows, primarily characterized by image generation delays exceeding 4 minutes, unprompted photo captures, and duplicate confirmation speech triggered by overheard ambient voices.",
  "featureSummaries": {
    "Camera & Vision": "Image generation latency exceeding 4 minutes during consecutive requests and spontaneous unprompted photo capture.",
    "Voice Assistant & Audio": "Duplicate voice confirmation feedback upon event creation and false voice-trigger activations from ambient background speech."
  }
}

CRITICAL ARCHITECTURAL RULES:
1. EXECUTIVE SYNTHESIS (NO RAW DUMPS):
   - Synthesize and distill root failure mechanisms into crisp engineering statements. DO NOT copy-paste raw tester notes, conversational narrative ("I noticed", "we saw"), or timestamps ("1:38 pm", "at 14:00").
   - Use precise defect terminology: "latency exceeding [duration]", "spontaneous unprompted [action]", "duplicate confirmation feedback upon [event]", "false voice-trigger activations from ambient background speech", "UI unresponsiveness", etc.
2. PRESERVE METRICS: Retain specific quantitative thresholds, durations, and counts from the logs (e.g., "exceeding 4 minutes", "10-second delay").
3. "overallSummary" REQUIREMENTS:
   - Provide a strategic, high-impact 1 to 2 sentence executive overview (25 to 45 words).
   - Follow this structure: "Testing revealed [key defect categories, e.g. latency, false-trigger, stability] issues across [affected feature/system flows], primarily characterized by [synthesized root causes with exact durations/metrics retained]..."
4. "featureSummaries" REQUIREMENTS:
   - Provide an entry in "featureSummaries" for EVERY feature listed in the input.
   - For each feature, provide a single, complete sentence (8 to 22 words) capturing the core defects (e.g. "[Primary defect phrase] and [Secondary defect phrase].").
   - Ensure it ends with a period.
5. NEVER TRUNCATE: Do not end sentences with ellipses (...) or cut off text.
6. RETURN FORMAT:
   Return valid JSON with this exact schema:
   {
     "overallSummary": "...",
     "featureSummaries": {
       "<FeatureName>": "..."
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

    // Dynamic auto-discovery: query Google for models supported by this user's API key
    try {
      const discovery = await discoverAvailableGeminiModels(userApiKey);
      if (discovery.success && discovery.models.length > 0) {
        for (const discoveredModel of discovery.models) {
          if (modelsToTry.includes(discoveredModel)) continue;
          try {
            const text = await callGeminiRestApi(userApiKey, discoveredModel, prompt, true);
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
                modelUsed: discoveredModel
              };
            }
          } catch (e: any) {
            lastErrorMessage = e?.message || String(e);
          }
        }
      } else if (discovery.error) {
        lastErrorMessage = discovery.error;
      }
    } catch (discErr: any) {
      lastErrorMessage = discErr?.message || String(discErr);
    }
  }

  // Clean fallback when API key is missing or call fails
  const fallbackFeatureMap: Record<string, string> = {};
  featuresWithBugs.forEach(f => {
    const notes = (f.bugs || []).map(b => b.note).filter(Boolean);
    fallbackFeatureMap[f.featureName] = nlpCleanReword(notes, f.featureName);
  });

  const allNotes = allBugs.map(b => b.note).filter(Boolean);
  const featureNamesWithBugs = featuresWithBugs.map(f => f.featureName);
  const fallbackOverall = allNotes.length > 0
    ? synthesizeExecutiveOverview(allNotes, featureNamesWithBugs)
    : '';

  return {
    overallSummary: fallbackOverall,
    featureSummaries: fallbackFeatureMap,
    error: lastErrorMessage || (!userApiKey ? 'No API Key configured' : undefined)
  };
}
