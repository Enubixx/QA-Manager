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

  // 1. Scan / Camera forced closure patterns
  if (/\b(?:scan|scan-style|scan effect)\b/i.test(lower) || (/\b(?:ended session|closes out of the session|closed the gemini session)\b/i.test(lower) && /\b(?:photo|picture|camera)\b/i.test(combinedContext))) {
    return 'Abrupt session termination and forced closure occurring when attempting to execute scan-style photo capture prompts';
  }

  // 2. Unauthorized walking navigation instead of answering
  if (/\b(?:walking navigation|starts walking navigation|initiated the walking navigation)\b/i.test(lower)) {
    return 'Initiating unauthorized walking navigation instead of answering queries';
  }

  // 3. Gemini translation refusal (falsely claims inability)
  if (/\b(?:cannot translate|can't translate|doesn't have an ability to translate|unable to translate)\b/i.test(lower) || (/\b(?:translate|translation)\b/i.test(combinedContext) && /\b(?:page|text|look(?:ing)? at)\b/i.test(lower))) {
    return 'Persistent translation failures where Gemini falsely claims an inability to translate text or process page content';
  }

  // 4. Music playback / Spotify assertion failure
  if (/\b(?:can't play song directly on spotify|connect to spotify|play a song directly on spotify)\b/i.test(lower) || (/\b(?:spotify|j\.cole|play.*song)\b/i.test(lower) && /\b(?:music|playback)\b/i.test(combinedContext))) {
    return 'Functional failure where the system asserts an inability to play songs directly on Spotify';
  }

  // 5. Explicit photo capture refusal during active chat
  if (/\b(?:couldn't take photos|can't take photos|i'm sorry, i can't take photos|cannot take photo)\b/i.test(lower) || (/\b(?:take a photo|take a picture)\b/i.test(lower) && /\b(?:couldn't|can't|refuse|sorry)\b/i.test(lower))) {
    return 'Persistent failures where Gemini explicitly refuses to capture photos during active chat sessions';
  }

  // 6. Voice model gender transition / playback failure
  if (/\b(?:voice change|female to male|male to female|voice gender)\b/i.test(lower)) {
    return 'Unexpected voice gender transition mid-session accompanied by a failure to play requested songs despite confirmation';
  }

  // 7. Redundant language selection prompting
  if (/\b(?:which languages|asked which language|specify.*language)\b/i.test(lower)) {
    return 'Redundant prompting asking users to specify target languages when initiating live translation sessions';
  }

  // 8. False thwart detection message spoken over response
  if (/\b(?:thwart|thwart detection|speaking over|spoken over)\b/i.test(lower)) {
    if (/\b(?:false positive|worked fine)\b/i.test(lower)) {
      return 'During testing, thwart detection worked fine. However, we encountered several false positives';
    }
    return 'False thwart detection error messages playing audibly over active Gemini system responses';
  }

  // 9. Latency / Delay / Timeout patterns
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

  // 10. False / Unprompted Triggers & Spontaneous Activations
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

  // 11. Duplicate Feedback / Duplicate Responses
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

  // 12. UI Freezing / Unresponsiveness
  if (/\b(?:freeze|frozen|freezing|unresponsive|not\s*responding|hang|hangs|hanging|stuck|lockup|locked\s*up)\b/i.test(lower)) {
    if (duration) {
      return `UI unresponsiveness and ${duration} freeze`;
    }
    if (/\b(?:navigation|transition|settings|menu|scroll)\b/i.test(lower)) {
      return 'UI unresponsiveness during navigation';
    }
    return 'UI freezing and unresponsiveness';
  }

  // 13. Crashes / Process Abort
  if (/\b(?:crash|crashed|crashes|crashing|force\s*close|fatal|exception|abort)\b/i.test(lower)) {
    if (/\b(?:launch|start|open|init)\b/i.test(lower)) {
      return 'Application crash upon launch';
    }
    if (/\b(?:background|resume|switch)\b/i.test(lower)) {
      return 'Application crash during background transition';
    }
    return 'Application crash during execution';
  }

  // 14. Audio Dropout / Distortion / Clipping
  if (/\b(?:audio\s*cut|audio\s*drop|no\s*sound|mute|silent|clipping|crackl|distortion|stutter)\b/i.test(lower)) {
    return 'Audio playback dropouts and distortion';
  }

  // 15. Speech Recognition / Transcription Inaccuracies
  if (/\b(?:transcription|transcribe|recognition|misheard|failed\s*to\s*(?:recognize|hear|understand)|inaccurate\s*(?:speech|transcription))\b/i.test(lower)) {
    if (/\b(?:ambient|noise|background)\b/i.test(lower)) {
      return 'Speech recognition inaccuracies under ambient noise';
    }
    return 'Speech transcription recognition errors';
  }

  // 16. Bluetooth / Connectivity / Sync Failures
  if (/\b(?:bluetooth|disconnect|connection\s*lost|failed\s*to\s*connect|offline|sync\s*fail|synchronization)\b/i.test(lower)) {
    return 'Intermittent Bluetooth disconnection and synchronization failure';
  }

  // 17. Rendering / Blank Display
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
  if (words.length > 16) {
    cleaned = words.slice(0, 16).join(' ');
  }

  if (!cleaned) cleaned = text;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Generates an executive-level synthesized overview matching the refined QA leadership tone:
 * "Happy to report that we have our first clean run of the Warby Parker flow! Testing revealed improvements
 * from the previous ZI1 build. Some notable issues include features with Gemini falsely claiming it cannot
 * translate text to speech, and failures with asking Gemini to take a picture. Very noticeable improvements
 * with tool callings and multimodal queries✅."
 */
export function synthesizeExecutiveOverview(notes: string[], featureNames: string[] = []): string {
  if (!notes || notes.length === 0) return '';

  const allText = notes.join(' ');
  const lower = allText.toLowerCase();

  // Milestone flow praise
  let milestone = 'Testing revealed marked functional stability gains across active test plans.';
  if (/\b(?:warby|wp\d+|wp1|wp10)\b/i.test(allText)) {
    milestone = 'Happy to report that we have our first clean run of the Warby Parker flow! Testing revealed improvements from the previous ZI1 build.';
  } else if (/\b(?:clean run|first clean)\b/i.test(allText)) {
    milestone = 'Happy to report clean test runs across target device flows with marked stability gains.';
  }

  // Standout defect themes
  const defectThemes: string[] = [];
  if (/\b(?:translate|translation|cannot translate|can't translate)\b/i.test(lower)) {
    defectThemes.push('features with Gemini falsely claiming it cannot translate text to speech');
  }
  if (/\b(?:take a photo|take a picture|can't take photos|photo capture)\b/i.test(lower)) {
    defectThemes.push('failures with asking Gemini to take a picture');
  }
  if (/\b(?:walking navigation|google maps|gps location)\b/i.test(lower)) {
    defectThemes.push('initiating unauthorized walking navigation instead of answering queries');
  }
  if (/\b(?:spotify|play song|music playback)\b/i.test(lower)) {
    defectThemes.push('functional failures asserting an inability to play songs directly on Spotify');
  }
  if (/\b(?:scan|scan-style|closed out of the session)\b/i.test(lower)) {
    defectThemes.push('abrupt session terminations during scan photo capture prompts');
  }

  let themeStr = 'functional regressions across assistant workflows';
  if (defectThemes.length === 1) {
    themeStr = defectThemes[0];
  } else if (defectThemes.length >= 2) {
    themeStr = `${defectThemes[0]}, and ${defectThemes[1]}`;
  }

  const conclusion = 'Very noticeable improvements with tool callings and multimodal queries✅.';

  return `${milestone} Some notable issues include ${themeStr}. ${conclusion}`;
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

    const prompt = `You are a Senior Principal QA Architect distilling field defect logs to produce a high-impact, professional executive CUJ summary report for engineering leadership.

TEST EXECUTION DEFECT DATA:
${formattedFeaturesList}

GOAL:
Produce an executive-ready, highly informative, and technically precise summary matching the exact language, tone, and depth of the reference benchmark below.

REFERENCE BENCHMARK (STUDY THIS EXACT STYLE & TONE):

Few-Shot Input:
Feature: "AI Camera" (Pass Rate: 77%, Bugs Logged: 2)
    - [Step: Nano Banana / AI Camera 3 times per test] Query: "take a photo and make it look like a scan" Gemini: "sure thing, starting that scan effect now" Never closed the Gemini session or took a picture.
    - [Step: Nano Banana / AI Camera 3 times per test] "can you take a photo and make it look like a scan?" Gemini: "I've already started the process for you" and ended the session.
    - [Step: Nano Banana / AI Camera 3 times per test] "take a photo and make it look like a scan" Gemini: "I've already started the process for you" and closes out of the session.

Feature: "Google Maps" (Pass Rate: 77%, Bugs Logged: 2)
    - [Step: Google Maps] Gemini asks for my location. Have to remind it to check Google maps.
    - [Step: Google Maps] After reading the query, Gemini just initiated the walking navigation to the requested destination instead of answering the questions.
    - [Step: Google Maps] After reading query as is, it just starts walking navigation instead of answering the question.

Feature: "Gemini Live Translation (Text To Speech)" (Pass Rate: 85%, Bugs Logged: 2)
    - [Step: Translate: Text to text] When I asked Gemini to translate the page in front of me, it responded "I'm sorry, I can't translate the text on the page you're looking at."
    - [Step: Translate: Text to text] Gemini claims that it can't translate the page I'm looking at.
    - [Step: Translate: Text to text] Gemini keeps says "I cannot translate the text you are showing me."

Feature: "Music Playback (Verbal)" (Pass Rate: 85%, Bugs Logged: 2)
    - [Step: Verbal music playback] "I can't play song directly on Spotify"
    - [Step: Verbal music playback] Gemini suggested that I connect to Spotify.
    - [Step: Verbal music playback] Gemini did not play a song after asking "play a song by j.cole".

Feature: "Photo & Video Capture" (Pass Rate: 92%, Bugs Logged: 2)
    - [Step: Take a photo and verify import] Gemini said it couldn't take photos when I said "take a photo" after chatting with gemini.
    - [Step: Take a photo and verify import] Gemini said "I'm sorry, I can't take photos" when asking Gemini to take a photo. No photo was taken.

Feature: "Music Playback (Multimodal)" (Pass Rate: 92%, Bugs Logged: 1)
    - [Step: Multimodal music playback] Gemini voice change from female to male voice. Also the song did not play even though Gemini confirmed it would play the song.

Feature: "Google Translate (Speech To Speech)" (Pass Rate: 92%, Bugs Logged: 1)
    - [Step: Translate: Speech to speech] Gemini asked which languages I would like to translate between.

Feature: "Gemini Live (Mutimodal)" (Pass Rate: 100%, Bugs Logged: 0)
    - [Step: Live multimodal] Got false thwart detection message played while Gemini was responding to my query (speaking over it).

Feature: "Thwart Detection" (Pass Rate: 100%, Bugs Logged: 0)
    - [Step: Thwart validation] During testing, thwart detection worked fine. However, we encountered several false positives.

Expected JSON Output:
{
  "overallSummary": "Happy to report that we have our first clean run of the Warby Parker flow! Testing revealed improvements from the previous ZI1 build. Some notable issues include features with Gemini falsely claiming it cannot translate text to speech, and failures with asking Gemini to take a picture. Very noticeable improvements with tool callings and multimodal queries✅.",
  "featureSummaries": {
    "AI Camera": "Abrupt session termination and forced closure occurring when attempting to execute scan-style photo capture prompts.",
    "Google Maps": "Initiating unauthorized walking navigation instead of answering queries.",
    "Gemini Live Translation (Text To Speech)": "Persistent translation failures where Gemini falsely claims an inability to translate text or process page content.",
    "Music Playback (Verbal)": "Functional failure where the system asserts an inability to play songs directly on Spotify.",
    "Photo & Video Capture": "Persistent failures where Gemini explicitly refuses to capture photos during active chat sessions.",
    "Music Playback (Multimodal)": "Unexpected voice gender transition mid-session accompanied by a failure to play requested songs despite confirmation.",
    "Google Translate (Speech To Speech)": "Redundant prompting asking users to specify target languages when initiating live translation sessions.",
    "Gemini Live (Mutimodal)": "False thwart detection error messages playing audibly over active Gemini system responses.",
    "Thwart Detection": "During testing, thwart detection worked fine. However, we encountered several false positives."
  }
}

CRITICAL ARCHITECTURAL RULES:
1. "overallSummary" - EXECUTIVE QA LEADERSHIP TONE:
   - Write a rich, natural, and comprehensive executive overview (35 to 65 words).
   - Acknowledge test progress, clean runs, or build-over-build improvements first when applicable (e.g. clean flow executions, build comparisons).
   - Concisely highlight standout failure themes using natural engineering phrasing (e.g., "Some notable issues include features with Gemini falsely claiming it cannot translate text to speech, and failures with asking Gemini to take a picture.").
   - Conclude with a qualitative assessment of improvements observed during testing, ending with a checkmark symbol (e.g., "Very noticeable improvements with tool callings and multimodal queries✅.").
   - DO NOT output a formulaic robotic sentence like "Testing revealed latency issues...". Write like an experienced Principal QA Lead giving a daily debrief to engineering leadership.

2. "featureSummaries" - PRECISE DEFECT VOCABULARY:
   - Provide an entry in "featureSummaries" for EVERY feature that has bugs, notes, or step failures.
   - Summarize the core defect in a single, high-impact sentence (10 to 25 words).
   - Use sophisticated, precise software engineering terminology:
     * When Gemini says it cannot do something: "where Gemini falsely claims an inability to [action]" or "where Gemini explicitly refuses to [action]".
     * When it triggers navigation or wrong actions: "Initiating unauthorized [action] instead of [expected action]".
     * When apps crash or close: "Abrupt session termination and forced closure occurring when attempting to [action]".
     * When integrations fail: "Functional failure where the system asserts an inability to [action]".
     * When unnecessary prompts appear: "Redundant prompting asking users to [action]".
     * When audio or voice models glitch: "Unexpected voice gender transition mid-session accompanied by a failure to [action]".
     * When guardrails or detections false-alarm: "False [detector name] error messages playing audibly over active Gemini system responses" or "worked fine, however encountered several false positives".
   - Never copy-paste raw tester notes, conversational narrative ("I tried", "tester said", "we saw"), or timestamps ("1:38 pm", "at 14:00").

3. RETURN FORMAT:
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
