import { GoogleGenAI } from '@google/genai';
import { BugLog } from '../types';

const summaryCache = new Map<string, string>();

/**
 * Persistent cross-session cache for expensive batch executive summaries.
 * Keyed by a stable hash of the API key, model, and exact defect payload, so
 * re-generating an unchanged report returns instantly with zero network calls.
 */
const BATCH_CACHE_KEY = 'qa_gemini_batch_summary_cache';
const BATCH_CACHE_MAX_ENTRIES = 12;

// Bump whenever the executive summary prompt or tone rules change, so that
// cached summaries generated under the previous style are not reused.
const PROMPT_STYLE_VERSION = 'v4-structured-issue-coverage';

function stableHash(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function readBatchCache(key: string): any | null {
  try {
    const raw = localStorage.getItem(BATCH_CACHE_KEY);
    if (!raw) return null;
    const store = JSON.parse(raw);
    const hit = store?.[key];
    if (hit && hit.overallSummary !== undefined) return hit;
  } catch (e) {}
  return null;
}

function writeBatchCache(key: string, value: any): void {
  try {
    const raw = localStorage.getItem(BATCH_CACHE_KEY);
    const store = raw ? JSON.parse(raw) : {};
    store[key] = { ...value, cachedAt: Date.now() };

    // Evict the oldest entries to keep localStorage small
    const keys = Object.keys(store);
    if (keys.length > BATCH_CACHE_MAX_ENTRIES) {
      keys
        .sort((a, b) => (store[a]?.cachedAt || 0) - (store[b]?.cachedAt || 0))
        .slice(0, keys.length - BATCH_CACHE_MAX_ENTRIES)
        .forEach(k => delete store[k]);
    }
    localStorage.setItem(BATCH_CACHE_KEY, JSON.stringify(store));
  } catch (e) {}
}

export function clearGeminiSummaryCaches(): void {
  summaryCache.clear();
  try {
    localStorage.removeItem(BATCH_CACHE_KEY);
  } catch (e) {}
}

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
    clearGeminiSummaryCaches();
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

/**
 * Default model for report summaries. Google shut down the Gemini 1.5 family and
 * Gemini 2.0 Flash / Flash-Lite (June 1, 2026); requests to them fail, which made
 * every report silently fall back to the offline summarizer.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

export const GEMINI_MODELS: GeminiModelOption[] = [
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (Recommended)', description: 'Latest stable Flash model - best balance of summary quality and speed' },
  { id: 'gemini-flash-latest', name: 'Gemini Flash (latest alias)', description: 'Always points at the newest Flash release' },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', description: 'Fastest and cheapest, slightly less nuanced summaries' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (Preview)', description: 'Deepest reasoning, noticeably slower' },
];

/**
 * Tried in order after the preferred model fails (e.g. it is not enabled for the
 * key, is rate limited, or returns an unusable response).
 */
const FALLBACK_SUMMARY_MODELS = [
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
];

function normalizeModelId(model: string): string {
  return (model || '').trim().replace(/^models\//i, '').trim();
}

/** Model families Google has shut down - requests to them always fail. */
export function isRetiredGeminiModel(model: string): boolean {
  const id = normalizeModelId(model).toLowerCase();
  return /^gemini-(?:1\.0|1\.5|2\.0)(?:-|$)/.test(id) || /^gemini-pro(?:-vision)?$/.test(id);
}

/** Audio, image, embedding, agent and other non-text models cannot write summaries. */
const NON_TEXT_MODEL_PATTERN = /(?:tts|live|audio|image|imagen|veo|embed|aqa|transcribe|omni|robotics|deep-research|lyria|antigravity|computer-use|nano-banana)/i;

export function isSuitableSummaryModel(model: string): boolean {
  const id = normalizeModelId(model);
  return !!id && !isRetiredGeminiModel(id) && !NON_TEXT_MODEL_PATTERN.test(id);
}

/**
 * Ranks model IDs (e.g. from ListModels) by suitability for report summaries:
 * Flash first, then Flash-Lite, then Pro; newer versions first; previews last.
 * Retired and non-text models are removed.
 */
export function rankModelsForSummaries(models: string[]): string[] {
  const score = (id: string): number => {
    const lower = id.toLowerCase();
    const tier = /flash-lite/.test(lower) ? 2 : /flash/.test(lower) ? 3 : /pro/.test(lower) ? 1 : 0;
    const versionMatch = lower.match(/^gemini-(\d+(?:\.\d+)?)/);
    const version = versionMatch ? parseFloat(versionMatch[1]) : 0;
    const isAlias = /-latest$/.test(lower);
    let s = tier * 10000 + (isAlias ? 50 : version * 100);
    if (/preview/.test(lower)) s -= 150;
    if (/exp/.test(lower)) s -= 300;
    return s;
  };
  const unique = Array.from(new Set(models.map(normalizeModelId).filter(Boolean)));
  return unique
    .filter(id => /^gemini-/i.test(id) && isSuitableSummaryModel(id))
    .sort((a, b) => score(b) - score(a));
}

export function pickBestSummaryModel(models: string[]): string | undefined {
  return rankModelsForSummaries(models)[0];
}

export function getStoredGeminiModel(): string {
  try {
    const saved = normalizeModelId(localStorage.getItem('qa_gemini_model') || '');
    // Honour any model the user picked unless Google retired it or it cannot
    // produce text. (Previously only 4 hard-coded, now-retired IDs were accepted.)
    if (saved && isSuitableSummaryModel(saved)) return saved;
  } catch (e) {}
  return DEFAULT_GEMINI_MODEL;
}

export function saveGeminiModel(model: string): void {
  try {
    const id = normalizeModelId(model);
    if (id) {
      localStorage.setItem('qa_gemini_model', id);
    } else {
      localStorage.removeItem('qa_gemini_model');
    }
    clearGeminiSummaryCaches();
  } catch (e) {}
}

/**
 * Remembers which API version (v1beta or v1) successfully resolved a given model,
 * so subsequent calls skip the wasted 404 round-trip entirely.
 */
const resolvedEndpointCache = new Map<string, string>();

function loadResolvedEndpoints(): void {
  try {
    const raw = localStorage.getItem('qa_gemini_resolved_endpoints');
    if (raw) {
      const parsed = JSON.parse(raw);
      Object.entries(parsed).forEach(([k, v]) => {
        if (typeof v === 'string') resolvedEndpointCache.set(k, v);
      });
    }
  } catch (e) {}
}
loadResolvedEndpoints();

function persistResolvedEndpoint(model: string, version: string): void {
  resolvedEndpointCache.set(model, version);
  try {
    const obj: Record<string, string> = {};
    resolvedEndpointCache.forEach((v, k) => { obj[k] = v; });
    localStorage.setItem('qa_gemini_resolved_endpoints', JSON.stringify(obj));
  } catch (e) {}
}

/**
 * Options for a single Gemini generateContent call.
 */
interface GeminiCallOptions {
  asJson?: boolean;
  timeoutMs?: number;
  maxOutputTokens?: number;
  /** OpenAPI-style schema for structured JSON output (only used with asJson). */
  responseSchema?: Record<string, unknown>;
}

/**
 * Error returned by the Gemini REST API. `fatal` errors (e.g. an invalid API key)
 * fail identically for every model, so callers should stop trying other models.
 */
class GeminiApiError extends Error {
  status?: number;
  fatal: boolean;

  constructor(message: string, status?: number, fatal: boolean = false) {
    super(message);
    this.name = 'GeminiApiError';
    this.status = status;
    this.fatal = fatal;
  }
}

/**
 * Gemini 3.x and later deprecate temperature / top_p / top_k (ignored today,
 * HTTP 400 in future model generations), so they are only sent to older models.
 */
function supportsSamplingParams(model: string): boolean {
  return /^gemini-(?:1|2)\./i.test(model);
}

/**
 * Errors caused by the API key or its Cloud project (invalid, expired, suspended,
 * leaked, blocked, API disabled...). They fail identically for every model.
 */
const KEY_LEVEL_ERROR_PATTERN =
  /API[_ ]?key (?:not valid|invalid|expired)|API_KEY_INVALID|API_KEY_EXPIRED|invalid api key|suspended|leaked|unrestricted|are blocked|API_KEY_SERVICE_BLOCKED|referr?er|SERVICE_DISABLED|has not been used in project|it is disabled|location is not supported/i;

function isKeyLevelError(status: number, message: string): boolean {
  return status === 401 || KEY_LEVEL_ERROR_PATTERN.test(message);
}

function maskApiKey(key: string): string {
  return `…${key.slice(-4)}`;
}

/**
 * Hides API keys in error text. Google echoes the full key in some errors
 * (e.g. "Consumer 'api_key:…' has been suspended"), and these messages are
 * shown in toasts and tooltips and written to the console.
 */
export function redactApiKeys(text: string, apiKey?: string): string {
  let out = text || '';
  const key = (apiKey || '').trim();
  if (key.length >= 8) {
    out = out.split(key).join(maskApiKey(key));
  }
  return out
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, m => maskApiKey(m))
    .replace(/\bAQ\.[0-9A-Za-z_-]{16,}(?:\.[0-9A-Za-z_-]+)*/g, m => maskApiKey(m));
}

/**
 * Plain-language fix for errors caused by the API key or its project, or null
 * when the error is not key-related.
 */
export function getGeminiKeyErrorHint(error?: string): string | null {
  if (!error) return null;
  if (/suspended/i.test(error)) {
    return 'Google has suspended this API key or its Cloud project. Create a new key in a new project at aistudio.google.com/apikey.';
  }
  if (/leaked/i.test(error)) {
    return 'Google flagged this API key as leaked. Create a new key at aistudio.google.com/apikey and keep it private.';
  }
  if (/API[_ ]?key expired|API_KEY_EXPIRED/i.test(error)) {
    return 'This API key has expired. Create a new one at aistudio.google.com/apikey.';
  }
  if (/API[_ ]?key not valid|API_KEY_INVALID|invalid api key/i.test(error)) {
    return 'This API key is not valid. Paste it again, or create a new one at aistudio.google.com/apikey.';
  }
  if (/unrestricted/i.test(error)) {
    return 'Google no longer accepts unrestricted keys. In AI Studio, restrict this key to the Gemini API, or create a new key.';
  }
  if (/referr?er/i.test(error)) {
    return "This key's website restrictions block this site. Update the key's restrictions or create a new key.";
  }
  if (/SERVICE_DISABLED|has not been used in project|it is disabled/i.test(error)) {
    return "The Gemini API is not enabled for this key's project. Create a key in AI Studio, which enables it automatically.";
  }
  if (/are blocked|API_KEY_SERVICE_BLOCKED/i.test(error)) {
    return 'This key is not allowed to use the Gemini API. Create a new key at aistudio.google.com/apikey.';
  }
  if (/location is not supported/i.test(error)) {
    return 'The Gemini API is not available in your region.';
  }
  return null;
}

/**
 * Direct native fetch call to Google's Gemini REST API.
 * Ensures 100% browser compatibility, handles 'models/' prefix, and falls back between v1beta and v1 endpoints.
 * Optimized: remembers the working API version per model, aborts hung requests, and caps output tokens.
 */
async function callGeminiRestApi(
  apiKey: string,
  model: string,
  prompt: string,
  options: GeminiCallOptions = {}
): Promise<string> {
  const { asJson = false, timeoutMs = 25000, maxOutputTokens = 1200, responseSchema } = options;
  const cleanModel = normalizeModelId(model);
  const key = apiKey.trim();

  // Prefer the API version previously proven to work for this model
  let versions = ['v1beta', 'v1'];
  const known = resolvedEndpointCache.get(cleanModel);
  if (known) {
    versions = [known, ...versions.filter(v => v !== known)];
  }

  let lastError = '';

  for (const version of versions) {
    // Key goes in the x-goog-api-key header only - keys in URLs leak into browser logs
    const url = `https://generativelanguage.googleapis.com/${version}/models/${cleanModel}:generateContent`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const generationConfig: Record<string, unknown> = { maxOutputTokens };
      if (supportsSamplingParams(cleanModel)) {
        generationConfig.temperature = 0.2;
      }
      if (asJson) {
        generationConfig.responseMimeType = 'application/json';
        if (responseSchema) {
          generationConfig.responseSchema = responseSchema;
        }
      }

      const bodyPayload = {
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        generationConfig
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key
        },
        body: JSON.stringify(bodyPayload),
        signal: controller.signal
      });

      if (response.ok) {
        const data = await response.json();
        const candidate = data?.candidates?.[0];
        const parts: any[] = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
        // Thinking models may return several parts - join the visible text and skip thought summaries
        const text = parts
          .filter(p => typeof p?.text === 'string' && !p?.thought)
          .map(p => p.text as string)
          .join('')
          .trim();
        const finishReason: string = candidate?.finishReason || '';

        if (finishReason === 'MAX_TOKENS') {
          throw new GeminiApiError(`Response was cut off at the ${maxOutputTokens}-token output limit`, response.status);
        }
        if (text) {
          persistResolvedEndpoint(cleanModel, version);
          return text;
        }
        const blockReason = data?.promptFeedback?.blockReason;
        throw new GeminiApiError(
          blockReason
            ? `Request blocked by safety filters (${blockReason})`
            : finishReason && finishReason !== 'STOP'
            ? `Empty response (finish reason: ${finishReason})`
            : 'Empty response from model',
          response.status
        );
      }

      const errorJson = await response.json().catch(() => null);
      // Google echoes the key in some errors - never let it reach the UI or logs
      const message = redactApiKeys(errorJson?.error?.message || `HTTP ${response.status}: ${response.statusText}`, key);
      // Only a 404 means "wrong API version for this model" - retry on the other version
      if (response.status === 404) {
        lastError = message;
        continue;
      }
      // Auth, quota, or payload errors will not be fixed by switching version - fail fast.
      // Key/project problems (invalid, suspended, leaked...) also rule out every other model.
      throw new GeminiApiError(message, response.status, isKeyLevelError(response.status, message));
    } catch (err: any) {
      if (err instanceof GeminiApiError) throw err;
      if (err?.name === 'AbortError') {
        throw new GeminiApiError(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
      }
      // Network-level failure - try the other API version once
      lastError = err?.message || String(err);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new GeminiApiError(lastError || `Model ${cleanModel} could not be resolved`, 404);
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
  // Key goes in the x-goog-api-key header only; pageSize avoids missing newer models on page 2
  const endpoints = [
    'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
    'https://generativelanguage.googleapis.com/v1/models?pageSize=1000'
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
        lastError = redactApiKeys(errData?.error?.message || `HTTP ${response.status}: ${response.statusText}`, key);
        // A bad / suspended key fails the same way on every API version
        if (isKeyLevelError(response.status, lastError)) break;
      }
    } catch (err: any) {
      lastError = redactApiKeys(err?.message || String(err), key);
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
 * Removes times of day that testers type into notes, e.g. "11.16 After I asked...",
 * "...from a visual query. 10.48am" or "...the camera 1.18". They are noise in summaries.
 */
const LEADING_TYPED_TIME = /^(?:\[?\d{1,2}[:.][0-5]\d\s*(?:am|pm)?\]?[:.-]?\s+|at\s+\d{1,2}[:.][0-5]\d\s*(?:am|pm)?[:,-]?\s*)/i;
const TRAILING_TYPED_TIME = /[\s,;:-]*(?:\bat\s+)?\(?\b\d{1,2}[:.][0-5]\d\s*(?:am|pm)?\)?\.?\s*$/i;

export function stripTypedTimestamps(raw: string): string {
  const original = (raw || '').trim();
  const stripped = original.replace(LEADING_TYPED_TIME, '').replace(TRAILING_TYPED_TIME, '').trim();
  return stripped.length >= 2 ? stripped : original;
}

/** Words that stay capitalized when they start a phrase in the middle of a list. */
const PROPER_LEADING_WORDS = new Set([
  'gemini', 'google', 'keep', 'spotify', 'youtube', 'android', 'pixel', 'bluetooth', 'chrome', 'gmail',
  'maps', 'calendar', 'translate', 'lens', 'instacart', 'uber', 'warby', 'apple', 'samsung', 'wifi', 'wi-fi',
  'alexa', 'siri', 'whatsapp'
]);

const CLAUSE_STARTERS = new Set(['but', 'which', 'since', 'because', 'so', 'although', 'though', 'while', 'whereas', 'then']);

function capitalizeFirst(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** Lowercases the first letter unless the first word is an acronym or a proper noun. */
function lowerFirstUnlessProper(text: string): string {
  const firstWord = text.split(/\s+/)[0] || '';
  const bare = firstWord.replace(/[^A-Za-z0-9'-]/g, '');
  if (!bare) return text;
  // Acronyms (DC, GL, UI), words with digits, inner capitals (YouTube, iOS) and "I" stay as written
  if (/[0-9]/.test(bare) || /[A-Z]/.test(bare.slice(1)) || /^I(?:'|$)/.test(bare)) return text;
  if (PROPER_LEADING_WORDS.has(bare.toLowerCase())) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function dedupeKey(phrase: string): string {
  return phrase.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Shortens text to at most `maxWords`, preferring a clause boundary (comma,
 * semicolon, "but", "which", ...). Only adds an ellipsis when no boundary exists.
 */
function truncateAtClauseBoundary(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  const minKeep = Math.max(4, Math.ceil(maxWords * 0.5));
  for (let i = maxWords; i >= minKeep; i--) {
    const last = words[i - 1];
    const next = (words[i] || '').toLowerCase().replace(/[^a-z]/g, '');
    if (/[,;:]$/.test(last) || CLAUSE_STARTERS.has(next)) {
      return words.slice(0, i).join(' ').replace(/[,;:]+$/, '');
    }
  }
  return `${words.slice(0, maxWords).join(' ').replace(/[,;:.]+$/, '')}…`;
}

/**
 * Faithful local condensation of one tester note (used when the AI is unavailable):
 * drops typed times and conversational lead-ins, keeps as many whole sentences as fit
 * in `maxWords`, and only shortens extremely long notes (at a clause boundary).
 */
export function condenseNoteFaithfully(raw: string, maxWords: number = 24): string {
  let text = stripTypedTimestamps(cleanRawNote(raw).replace(/\s+/g, ' ').trim());
  if (!text) return '';
  text = text
    .replace(/^(?:so|also|and|then)\s+/i, '')
    .replace(/^(?:i|we)\s+(?:noticed|observed|saw|found|realized|realised)\s+(?:that\s+)?/i, '')
    .replace(/^(?:it\s+)?(?:seems|seemed|looks|looked)\s+like\s+/i, '')
    .replace(/^(?:the\s+)?(?:user\s+)?(?:noticed|observed|reported)\s+that\s+/i, '')
    .trim() || text;

  // Split into sentences without breaking decimals such as "2.5 seconds"
  const sentences = text
    .replace(/([.!?;])\s+/g, '$1\u0000')
    .split('\u0000')
    .map(s => s.trim().replace(/[.!?;,:]+$/, ''))
    .filter(Boolean);

  let picked = sentences[0] || text;
  // An over-long "After/When X, Y" sentence: the problem is in Y, so drop the setup clause
  if (countWords(picked) > maxWords) {
    const setup = picked.match(/^(?:after|when|while|once|upon|as soon as)\b[^,]{3,200},\s*(.+)$/i);
    if (setup && countWords(setup[1]) >= 4) picked = setup[1];
  }
  // Testers often state the actual problem in the next sentence - keep sentences while they fit
  for (let i = 1; i < sentences.length; i++) {
    const fits = countWords(picked) + countWords(sentences[i]) <= maxWords;
    if (!fits && countWords(picked) >= 5) break;
    picked = `${picked} - ${lowerFirstUnlessProper(sentences[i])}`;
    if (!fits) break;
  }

  picked = truncateAtClauseBoundary(picked, maxWords).replace(/[\s.;,:!?-]+$/, '').trim();
  return capitalizeFirst(picked);
}

/**
 * Joins issue phrases into one readable sentence: "A, B, and C." (semicolons when a
 * phrase already contains a comma). Every phrase is kept - nothing is dropped.
 */
export function joinIssuePhrases(phrases: string[]): string {
  const items = phrases
    .map(p => (p || '').replace(/\s+/g, ' ').trim().replace(/[\s.;,:]+$/, ''))
    .filter(Boolean)
    .map((p, i) => (i === 0 ? capitalizeFirst(p) : lowerFirstUnlessProper(p)));
  if (items.length === 0) return '';

  let body: string;
  if (items.length === 1) {
    body = items[0];
  } else if (items.length === 2) {
    body = `${items[0]} and ${items[1]}`;
  } else {
    const sep = items.some(p => p.includes(',')) ? '; ' : ', ';
    body = `${items.slice(0, -1).join(sep)}${sep}and ${items[items.length - 1]}`;
  }
  return /[.!?…]$/.test(body) ? body : `${body}.`;
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
export function extractIntelligentDefectPattern(note: string, featureContext: string = '', maxWords: number = 24): string {
  const text = stripTypedTimestamps(cleanRawNote(note));
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

  // General fallback: faithful condensation of the tester's own words. This used to
  // chop every note at 16 words mid-sentence, which produced cut-off summaries.
  return condenseNoteFaithfully(text, maxWords) || capitalizeFirst(text);
}

/**
 * Generates an executive-level synthesized overview matching the refined QA leadership tone:
 * "Happy to report that we have our first clean run of the Warby Parker flow! Testing revealed improvements
 * from the previous ZI1 build. Some notable issues include features with Gemini falsely claiming it cannot
 * translate text to speech, and failures with asking Gemini to take a picture. Very noticeable improvements
 * with tool callings and multimodal queries✅."
 */
export function synthesizeExecutiveOverview(
  notes: string[],
  featureNames: string[] = [],
  cleanFeatures: string[] = []
): string {
  if (!notes || notes.length === 0) {
    if (cleanFeatures.length > 0) {
      return `Testing completed with 100% pass rate across active CUJ flows (${cleanFeatures.slice(0, 3).join(', ')}). No functional regressions or blocking defects identified✅.`;
    }
    return 'Testing completed with 100% pass rate across active CUJ flows. No functional regressions or blocking defects identified✅.';
  }

  const allText = notes.join(' ');
  const lower = allText.toLowerCase();

  // 1. Extract standout defect themes dynamically from the actual notes.
  //    Reference-report style leads with the issues, so themes are computed first.
  const defectThemes: string[] = [];

  if (/\b(?:translate|translation|cannot translate|can't translate)\b/i.test(lower)) {
    defectThemes.push('false claims of lacking translation capability');
  }
  if (/\b(?:take a photo|take a picture|can't take photos|refuses to capture|couldn't take)\b/i.test(lower)) {
    defectThemes.push('intermittent refusals during photo capture requests');
  }
  if (/\b(?:scan|ended session|closed session|force close|abrupt|crashed)\b/i.test(lower)) {
    defectThemes.push('abrupt session terminations and forced closures during intensive tasks');
  }
  if (/\b(?:navigation|walking navigation|gps location|destination)\b/i.test(lower)) {
    defectThemes.push('unauthorized navigation triggers instead of direct query responses');
  }
  if (/\b(?:playback|play song|spotify|music|audio drop|voice change)\b/i.test(lower)) {
    defectThemes.push('functional assertions and playback failures during media requests');
  }
  if (/\b(?:latency|delay|slow|timeout|timed out|hang)\b/i.test(lower)) {
    defectThemes.push('processing latency during sequential requests');
  }
  if (/\b(?:false positive|false trigger|thwart|ambient)\b/i.test(lower)) {
    defectThemes.push('false-positive guardrail and detection triggers');
  }
  if (/\b(?:camera access|camera unavailable|can't see|cannot see|no camera)\b/i.test(lower)) {
    defectThemes.push('persistent refusals regarding camera accessibility');
  }
  if (/\b(?:previous|stale|carry ?over|earlier frame|prior query)\b/i.test(lower)) {
    defectThemes.push('context-carryover from previous frames');
  }

  // If none matched rule keywords, extract top pattern phrases dynamically from actual notes
  if (defectThemes.length === 0) {
    for (const note of notes.slice(0, 3)) {
      const p = extractIntelligentDefectPattern(note, '');
      if (p) {
        defectThemes.push(p.charAt(0).toLowerCase() + p.slice(1).replace(/[.]+$/, ''));
      }
    }
  }

  // Up to three themes, joined as "A, B, and C" to match the reference report cadence.
  const topThemes = Array.from(new Set(defectThemes)).slice(0, 3);
  let themeStr = 'functional regressions across target workflows';
  if (topThemes.length === 1) {
    themeStr = topThemes[0];
  } else if (topThemes.length === 2) {
    themeStr = `${topThemes[0]} and ${topThemes[1]}`;
  } else if (topThemes.length >= 3) {
    themeStr = `${topThemes[0]}, ${topThemes[1]}, and ${topThemes[2]}`;
  }

  const issuesSentence = `Some notable issues include ${themeStr}.`;

  // 2. Recurring systemic pattern sentence - only emitted when one failure mode
  //    genuinely repeats across a meaningful share of today's notes.
  let recurringSentence = '';
  const patternCounts = new Map<string, number>();
  for (const note of notes) {
    const p = extractIntelligentDefectPattern(note, '');
    if (!p) continue;
    const key = p.replace(/[.]+$/, '').trim().toLowerCase();
    if (!key) continue;
    patternCounts.set(key, (patternCounts.get(key) || 0) + 1);
  }
  let topPattern = '';
  let topCount = 0;
  patternCounts.forEach((count, key) => {
    if (count > topCount) {
      topCount = count;
      topPattern = key;
    }
  });
  if (topPattern && topCount >= 3 && topCount / notes.length >= 0.2) {
    const requiresRestart = /\b(?:restart|reboot|power cycle|unresponsive|froze|frozen)\b/i.test(lower);
    recurringSentence = requiresRestart
      ? ` There are noticeable common occurrences of ${topPattern}, which forces a needed device restart.`
      : ` There are noticeable common occurrences of ${topPattern} across multiple CUJs.`;
  }

  // 3. Constructive closing note
  const cleanNote = cleanFeatures.length > 0
    ? `Noticeable improvements observed across core tool callings, including clean execution in ${cleanFeatures.slice(0, 2).join(' and ')}\u2705.`
    : 'Noticeable improvements observed across core tool callings and active query flows\u2705.';

  return `${issuesSentence}${recurringSentence} ${cleanNote}`;
}

/** Longest single-note phrase the offline summarizer keeps before shortening it. */
const OFFLINE_PHRASE_MAX_WORDS = 40;

/**
 * Synthesizes raw QA notes into concise, clean executive defect phrases.
 * Every distinct issue is kept (this used to join only the first two); repeats are
 * counted as "(Nx)" and the most frequent issues are listed first. Each phrase is a
 * faithful condensation of the tester's note - canned rewrites could state things
 * that were never reported, so they are no longer used for per-CUJ summaries.
 */
export function nlpCleanReword(notes: string[], featureName: string): string {
  if (!notes || notes.length === 0) return '';

  if (featureName.toLowerCase() === 'overall') {
    return synthesizeExecutiveOverview(notes, []);
  }

  const tally = new Map<string, { phrase: string; count: number; order: number }>();
  for (const note of notes) {
    const phrase = condenseNoteFaithfully(note, OFFLINE_PHRASE_MAX_WORDS);
    if (!phrase) continue;
    const key = dedupeKey(phrase);
    const existing = tally.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      tally.set(key, { phrase, count: 1, order: tally.size });
    }
  }

  const ranked = Array.from(tally.values()).sort((a, b) => b.count - a.count || a.order - b.order);
  return joinIssuePhrases(ranked.map(({ phrase, count }) => (count > 1 ? `${phrase} (${count}x)` : phrase)));
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

      const responseText = await callGeminiRestApi(userApiKey, selectedModel, prompt, { maxOutputTokens: 8192 });
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
 *
 * PERF: This runs inside the render loop for every feature row. It must stay
 * 100% local - previously it fired a background Gemini request per feature on
 * every re-render, which saturated the API rate limit and starved the main
 * executive summary request. Identical output text, zero network cost.
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

      const responseText = await callGeminiRestApi(userApiKey, selectedModel, prompt, { maxOutputTokens: 8192 });
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
  fromCache?: boolean;
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

/** Time budgets for the batch report call (Gemini 3 models think before answering). */
const BATCH_ATTEMPT_TIMEOUT_MS = 75000;
const BATCH_TOTAL_BUDGET_MS = 150000;
const BATCH_MIN_ATTEMPT_MS = 8000;
// Thinking tokens count against this limit on Gemini 3 models - keep it generous so the JSON is never cut off.
const BATCH_MAX_OUTPUT_TOKENS = 32768;

/**
 * Structured-output schema for the batch report: per CUJ, a list of distinct issues,
 * each citing the bug numbers it covers, so coverage can be verified in code.
 */
const BATCH_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    features: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          featureId: { type: 'STRING' },
          issues: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                bugIds: { type: 'ARRAY', items: { type: 'INTEGER' } },
                summary: { type: 'STRING' }
              },
              required: ['bugIds', 'summary'],
              propertyOrdering: ['bugIds', 'summary']
            }
          }
        },
        required: ['featureId', 'issues'],
        propertyOrdering: ['featureId', 'issues']
      }
    },
    overallSummary: { type: 'STRING' }
  },
  required: ['features', 'overallSummary'],
  propertyOrdering: ['features', 'overallSummary']
};

interface LabeledBug {
  n: number;
  note: string;
  step: string;
}

interface LabeledFeature {
  id: string;
  featureName: string;
  healthScorePct: number;
  bugs: LabeledBug[];
}

/** Prompt-ready note: no list markers, typed times of day, or line breaks. */
function cleanNoteForPrompt(note: string): string {
  return stripTypedTimestamps(cleanRawNote(note || '')).replace(/\s+/g, ' ').trim();
}

/** Parses model JSON, tolerating code fences or stray text around the object. */
function parseJsonLoose(text: string): any {
  const trimmed = (text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch (inner) {}
    }
  }
  throw new Error('AI response was not valid JSON');
}

/** Normalizes one AI issue phrase: no quotes, bullets, trailing period, or model-added counts. */
function cleanIssuePhrase(raw: string): string {
  return (raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-•*]\s+/, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/\s*\((?:x\s*\d+|\d+\s*(?:x|×|times?|reports?|bugs?))\)$/i, '')
    .replace(/[\s.;,:]+$/, '')
    .trim();
}

/**
 * Turns the structured AI response into one summary sentence per CUJ while enforcing
 * that every bug is covered: issues citing no real bug are dropped as unsupported,
 * and any bug the model skipped is appended in condensed form.
 */
function assembleBatchResult(
  parsed: any,
  labeledFeatures: LabeledFeature[]
): { featureSummaries: Record<string, string>; overallSummary: string; matchedCount: number; uncoveredCount: number } {
  const entries: any[] = Array.isArray(parsed?.features) ? parsed.features : [];
  const byIndex = new Map<number, any>();
  const byName = new Map<string, any>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const idMatch = String(entry.featureId ?? entry.id ?? '').match(/(\d+)/);
    if (idMatch) {
      const idx = parseInt(idMatch[1], 10);
      if (!byIndex.has(idx)) byIndex.set(idx, entry);
    }
    const name = [entry.featureName, entry.feature, entry.name].find(v => typeof v === 'string');
    if (name) byName.set(String(name).trim().toLowerCase(), entry);
  }

  const featureSummaries: Record<string, string> = {};
  let matchedCount = 0;
  let uncoveredCount = 0;

  labeledFeatures.forEach((feature, index) => {
    const entry = byIndex.get(index + 1) || byName.get(feature.featureName.trim().toLowerCase());
    if (entry) matchedCount++;

    const validIds = new Set(feature.bugs.map(b => b.n));
    const covered = new Set<number>();
    const merged = new Map<string, { summary: string; ids: Set<number> }>();

    const issues: any[] = Array.isArray(entry?.issues) ? entry.issues : [];
    for (const issue of issues) {
      const summary = cleanIssuePhrase(typeof issue?.summary === 'string' ? issue.summary : '');
      if (!summary) continue;
      const rawIds: unknown[] = Array.isArray(issue?.bugIds) ? issue.bugIds : [];
      const ids = rawIds
        .map(v => (typeof v === 'number' ? v : parseInt(String(v).replace(/[^\d]/g, ''), 10)))
        .filter(n => Number.isInteger(n) && validIds.has(n));
      // An issue that cites no real bug is not supported by today's data - drop it
      if (ids.length === 0) continue;
      ids.forEach(n => covered.add(n));
      const key = dedupeKey(summary);
      const existing = merged.get(key);
      if (existing) {
        ids.forEach(n => existing.ids.add(n));
      } else {
        merged.set(key, { summary, ids: new Set(ids) });
      }
    }

    const phrases: string[] = [];
    merged.forEach(({ summary, ids }) => phrases.push(ids.size > 1 ? `${summary} (${ids.size}x)` : summary));

    // Guarantee coverage: any bug the model skipped is added from the tester's own note
    const skipped = new Map<string, { phrase: string; count: number }>();
    for (const bug of feature.bugs) {
      if (covered.has(bug.n)) continue;
      const phrase = condenseNoteFaithfully(bug.note, 24);
      if (!phrase) continue;
      uncoveredCount++;
      const key = dedupeKey(phrase);
      const existing = skipped.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        skipped.set(key, { phrase, count: 1 });
      }
    }
    skipped.forEach(({ phrase, count }) => phrases.push(count > 1 ? `${phrase} (${count}x)` : phrase));

    const sentence = joinIssuePhrases(phrases);
    if (sentence) featureSummaries[feature.featureName] = sentence;
  });

  const overallSummary = typeof parsed?.overallSummary === 'string'
    ? parsed.overallSummary.replace(/\s+/g, ' ').trim()
    : '';
  return { featureSummaries, overallSummary, matchedCount, uncoveredCount };
}

/** Everything needed to ask an AI for the batch report and to read its answer back. */
interface BatchSummaryRequest {
  labeledFeatures: LabeledFeature[];
  formattedFeaturesList: string;
  cleanFeaturesSummary: string;
  prompt: string;
  /** Fingerprint of exactly the bugs in the prompt - detects replies to an outdated prompt. */
  reportId: string;
  buildOfflineOverall: () => string;
}

/**
 * Builds the batch-report prompt plus the context needed to map the AI's answer back.
 * Shared by the Gemini API path and the "paste into any AI chat" path, so both send the same prompt.
 */
function prepareBatchSummaryRequest(features: FeaturePayload[], allBugs: BugLog[]): BatchSummaryRequest {
  const healthyFeatures = features.filter(f => f.healthScorePct === 100 && (!f.bugs || f.bugs.length === 0));
  const featuresWithBugs = features.filter(f => f.bugs && f.bugs.length > 0);

  // Label every CUJ (F1, F2, ...) and number its bugs (#1, #2, ...) so the model reports
  // exactly which bugs each issue covers - that is how dropped issues are detected.
  const labeledFeatures: LabeledFeature[] = featuresWithBugs
    .map(f => ({
      featureName: f.featureName,
      healthScorePct: f.healthScorePct,
      notes: (f.bugs || [])
        .map(b => ({ note: cleanNoteForPrompt(b.note), step: (b.stepTitle || '').replace(/\s+/g, ' ').trim() }))
        .filter(b => b.note.length > 0)
    }))
    .filter(f => f.notes.length > 0)
    .map((f, i) => ({
      id: `F${i + 1}`,
      featureName: f.featureName,
      healthScorePct: f.healthScorePct,
      bugs: f.notes.map((b, j) => ({ n: j + 1, note: b.note, step: b.step }))
    }));

  // Format all defect logs cleanly grouped by feature
  const formattedFeaturesList = labeledFeatures.map(f => {
    const bugLines = f.bugs.map(b => {
      const step = b.step && b.step.toLowerCase() !== f.featureName.toLowerCase() ? `[Step: ${b.step}] ` : '';
      return `  #${b.n} ${step}${b.note}`;
    });
    return `${f.id}: "${f.featureName}" (pass rate ${f.healthScorePct}%, ${f.bugs.length} bug${f.bugs.length === 1 ? '' : 's'})\n${bugLines.join('\n')}`;
  }).join('\n\n');

  const cleanFeaturesSummary = healthyFeatures.length > 0
    ? healthyFeatures.map(f => f.featureName).join(', ')
    : 'None';

  const buildOfflineOverall = (): string => {
    const allNotes = allBugs.map(b => b.note).filter(Boolean);
    const featureNamesWithBugs = featuresWithBugs.map(f => f.featureName);
    const cleanFeatureNames = healthyFeatures.map(f => f.featureName);
    return allNotes.length > 0
      ? synthesizeExecutiveOverview(allNotes, featureNamesWithBugs, cleanFeatureNames)
      : (cleanFeatureNames.length > 0
          ? `Testing completed with 100% pass rate across active CUJ flows (${cleanFeatureNames.slice(0, 3).join(', ')}). No functional regressions or blocking defects identified✅.`
          : '');
  };

  const prompt = `You are a senior QA lead writing today's CUJ (critical user journey) bug report for engineering leadership.

Below are TODAY'S bug reports, grouped by CUJ. Each CUJ has an ID (F1, F2, ...) and its bugs are numbered #1, #2, ... (the numbering restarts in every CUJ). Testers type notes quickly, so expect typos, shorthand, internal acronyms, and stray times of day such as "10.48am" or "1.18" - ignore the times.

CLEAN CUJs (passed with no bugs today): ${cleanFeaturesSummary}

CUJs WITH BUGS (${labeledFeatures.length}):
${formattedFeaturesList}

TASK 1 - "features": a complete, de-duplicated issue list for EVERY CUJ above.
- Read every bug. One note can describe several problems - split them into separate issues (e.g. "latency and it couldn't connect to the camera" is two issues).
- Merge bugs that describe the same problem into ONE issue and list ALL of their numbers in "bugIds".
- COVERAGE IS MANDATORY: every bug number of a CUJ must appear in at least one of that CUJ's issues. Never drop a problem because it seems minor or was reported only once.
- "summary" paraphrases the problem as a short noun phrase of roughly 4 to 14 words. Do NOT copy the tester's sentence and do NOT write a full sentence. Style examples: "slow responses of up to 6 seconds", "app closes without responding", "reports success but the action never happens".
- Keep details that help triage: durations, the trigger or step, and the app or component involved. Keep product names and acronyms exactly as written.
- No tester names, no times of day, no "I" or "we", no trailing period, and no commas or parentheses inside a summary.
- Start each summary in lowercase unless its first word is a proper noun or an acronym.
- Within a CUJ, order issues by how many bugs report them, then by severity (crashes and wrong behaviour before minor annoyances).
- Use the exact CUJ IDs (F1, F2, ...) as "featureId" and include every CUJ listed above exactly once.

TASK 2 - "overallSummary": an executive overview of today's results (40 to 75 words, 2 to 3 sentences).
- Sentence 1 (required): lead with the dominant cross-CUJ themes from today's bugs: "Some notable issues include [theme A], [theme B], and [theme C]." You may prepend one short clause about clean CUJs, but never push the issues past sentence two.
- Sentence 2 (include ONLY if a problem clearly repeats across several CUJs): "There are noticeable common occurrences of [behaviour] when [trigger], which [impact]."
- Sentence 3 (required): a short positive closing note grounded in today's data, such as the CUJs that ran clean. A trailing checkmark is optional.
- Concrete triggers and impacts beat abstract adjectives.

STRICT GROUNDING:
- Use ONLY the bug reports above. Never invent issues, causes, numbers, products, or improvements that they do not support.
- Paraphrase faithfully: do not exaggerate (say "crash" only if a crash was reported) and do not soften real failures.

FORMAT EXAMPLE (a different product - copy the structure, never the content):
Input:
CLEAN CUJs (passed with no bugs today): Login
F1: "Photo Upload" (pass rate 60%, 4 bugs)
  #1 took like 20 sec to upload a photo
  #2 Upload spinner never stopped, had to restart the app. also slow
  #3 [Step: Share album] said it shared the album but my friend never got it
  #4 super slow upload again
Output:
{"features":[{"featureId":"F1","issues":[{"bugIds":[1,2,4],"summary":"slow photo uploads taking up to 20 seconds"},{"bugIds":[2],"summary":"upload spinner hangs until the app is restarted"},{"bugIds":[3],"summary":"album share reported as sent but never delivered"}]}],"overallSummary":"Login ran clean, but some notable issues include photo uploads taking up to 20 seconds, an upload spinner that hangs until the app is restarted, and album shares that are reported as sent but never arrive. The Login flow remained stable throughout testing ✅."}

Return ONLY the JSON object.`;

  const reportId = `QA-${stableHash(`${PROMPT_STYLE_VERSION}|${cleanFeaturesSummary}|${formattedFeaturesList}`)}`;

  return { labeledFeatures, formattedFeaturesList, cleanFeaturesSummary, prompt, reportId, buildOfflineOverall };
}

/**
 * Dedicated subtask that extracts all bugs and their features, prompts Gemini with full context,
 * and returns high-quality, structured executive summaries for both overall session and per feature.
 */
export async function generateBatchExecutiveSummaryWithGemini(
  features: FeaturePayload[],
  allBugs: BugLog[] = []
): Promise<ExecutiveQAResult> {
  const healthyFeatures = features.filter(f => f.healthScorePct === 100 && (!f.bugs || f.bugs.length === 0));
  const featuresWithBugs = features.filter(f => f.bugs && f.bugs.length > 0);

  if (featuresWithBugs.length === 0 && allBugs.length === 0) {
    const cleanList = healthyFeatures.map(f => f.featureName);
    return {
      overallSummary: cleanList.length > 0
        ? `Testing completed with 100% pass rate across active CUJ flows (${cleanList.slice(0, 3).join(', ')}). No functional regressions or blocking defects identified✅.`
        : '',
      featureSummaries: {}
    };
  }

  const {
    labeledFeatures,
    formattedFeaturesList,
    cleanFeaturesSummary,
    prompt,
    buildOfflineOverall
  } = prepareBatchSummaryRequest(features, allBugs);

  const userApiKey = getStoredGeminiApiKey();
  const preferredModel = getStoredGeminiModel();
  const failures: string[] = [];

  // Instant return on an unchanged dataset - avoids a multi-second round trip entirely.
  // PROMPT_STYLE_VERSION is part of the key so that changing the summary prompt/tone
  // invalidates previously cached summaries instead of serving stale-style text.
  const cacheKey = stableHash(
    `${PROMPT_STYLE_VERSION}|${userApiKey}|${preferredModel}|${cleanFeaturesSummary}|${formattedFeaturesList}`
  );
  const cached = readBatchCache(cacheKey);
  if (cached) {
    return {
      overallSummary: cached.overallSummary,
      featureSummaries: cached.featureSummaries || {},
      modelUsed: cached.modelUsed,
      fromCache: true
    };
  }

  if (userApiKey && labeledFeatures.length > 0) {
    const startedAt = Date.now();
    const remainingMs = () => BATCH_TOTAL_BUDGET_MS - (Date.now() - startedAt);
    const tried = new Set<string>();
    let stopTrying = false;

    const runAttempt = async (modelName: string): Promise<ExecutiveQAResult> => {
      const callOnce = (withSchema: boolean) =>
        callGeminiRestApi(userApiKey, modelName, prompt, {
          asJson: true,
          timeoutMs: Math.max(BATCH_MIN_ATTEMPT_MS, Math.min(BATCH_ATTEMPT_TIMEOUT_MS, remainingMs())),
          maxOutputTokens: BATCH_MAX_OUTPUT_TOKENS,
          responseSchema: withSchema ? BATCH_RESPONSE_SCHEMA : undefined
        });

      let text: string;
      try {
        text = await callOnce(true);
      } catch (err) {
        // If this model / API version rejects the schema, retry once in plain JSON mode
        const schemaRejected = err instanceof GeminiApiError && err.status === 400 &&
          /schema|unknown name|invalid json payload|propertyordering/i.test(err.message);
        if (!schemaRejected) throw err;
        text = await callOnce(false);
      }

      const assembled = assembleBatchResult(parseJsonLoose(text), labeledFeatures);
      if (assembled.matchedCount === 0) {
        throw new Error('AI response did not include any of the CUJs');
      }
      if (assembled.uncoveredCount > 0) {
        console.warn(`Gemini (${modelName}) skipped ${assembled.uncoveredCount} bug(s); they were added from the raw notes.`);
      }
      return {
        overallSummary: assembled.overallSummary || buildOfflineOverall(),
        featureSummaries: assembled.featureSummaries,
        modelUsed: modelName
      };
    };

    const tryModels = async (models: string[]): Promise<ExecutiveQAResult | null> => {
      for (const modelName of models) {
        if (stopTrying) break;
        if (!modelName || tried.has(modelName)) continue;
        if (remainingMs() < BATCH_MIN_ATTEMPT_MS) {
          stopTrying = true;
          break;
        }
        tried.add(modelName);
        try {
          const result = await runAttempt(modelName);
          writeBatchCache(cacheKey, result);
          return result;
        } catch (err: any) {
          failures.push(`${modelName}: ${err?.message || String(err)}`);
          console.warn(`Gemini batch executive summary call failed with ${modelName}:`, err);
          // Key/project problems (invalid, suspended, leaked...) fail identically for every model - stop right away
          if (err instanceof GeminiApiError && err.fatal) stopTrying = true;
        }
      }
      return null;
    };

    // The preferred model first, then current-generation fallbacks
    const primary = await tryModels([preferredModel, ...FALLBACK_SUMMARY_MODELS]);
    if (primary) return primary;

    // Last resort: ask Google which models this key can use and try the two best text models
    if (!stopTrying && remainingMs() >= BATCH_MIN_ATTEMPT_MS) {
      try {
        const discovery = await discoverAvailableGeminiModels(userApiKey);
        if (discovery.success) {
          const candidates = rankModelsForSummaries(discovery.models).filter(m => !tried.has(m)).slice(0, 2);
          const discovered = await tryModels(candidates);
          if (discovered) return discovered;
        } else if (discovery.error) {
          failures.push(`model discovery: ${discovery.error}`);
        }
      } catch (discErr: any) {
        failures.push(`model discovery: ${discErr?.message || String(discErr)}`);
      }
    }
  }

  // Clean fallback when API key is missing or call fails
  const fallbackFeatureMap: Record<string, string> = {};
  featuresWithBugs.forEach(f => {
    const notes = (f.bugs || []).map(b => b.note).filter(Boolean);
    fallbackFeatureMap[f.featureName] = nlpCleanReword(notes, f.featureName);
  });

  const errorSummary = failures.length === 0
    ? undefined
    : failures.length === 1
    ? failures[0]
    : `${failures[0]} (+${failures.length - 1} more failed attempt${failures.length - 1 === 1 ? '' : 's'})`;

  return {
    overallSummary: buildOfflineOverall(),
    featureSummaries: fallbackFeatureMap,
    error: errorSummary || (!userApiKey ? 'No API Key configured' : undefined)
  };
}

/** Shown as the "model" when the summary came from a pasted AI chat reply. */
export const CHAT_REPLY_MODEL_LABEL = 'AI chat (pasted reply)';

export interface ChatSummaryPrompt {
  prompt: string;
  reportId: string;
  cujCount: number;
  bugCount: number;
}

/**
 * Prompt for any AI chat (Gemini app, a coding assistant, ...) - no API key needed.
 * Read the reply back with applyChatSummaryReply. Returns null when there is nothing to summarize.
 */
export function buildChatSummaryPrompt(features: FeaturePayload[], allBugs: BugLog[] = []): ChatSummaryPrompt | null {
  const request = prepareBatchSummaryRequest(features, allBugs);
  if (request.labeledFeatures.length === 0) return null;

  const prompt = `${request.prompt}

REPORT ID: ${request.reportId}
This request comes through a chat window, so:
- Reply with ONLY the JSON object - no explanation before or after it. A single json code block is fine.
- Add "reportId": "${request.reportId}" as the first field of the JSON object.`;

  return {
    prompt,
    reportId: request.reportId,
    cujCount: request.labeledFeatures.length,
    bugCount: request.labeledFeatures.reduce((sum, f) => sum + f.bugs.length, 0)
  };
}

/**
 * Reads an AI chat reply to buildChatSummaryPrompt into the same result as the Gemini API
 * path (every bug covered, duplicates merged with counts). Throws an Error with a
 * user-facing message when the reply can't be used.
 */
export function applyChatSummaryReply(
  features: FeaturePayload[],
  allBugs: BugLog[],
  replyText: string
): ExecutiveQAResult {
  const request = prepareBatchSummaryRequest(features, allBugs);
  if (request.labeledFeatures.length === 0) {
    throw new Error('There are no bug notes for this day, so there is nothing to summarize.');
  }
  if (!replyText || !replyText.trim()) {
    throw new Error("Paste the AI's reply first.");
  }

  let parsed: any;
  try {
    parsed = parseJsonLoose(replyText);
  } catch (e) {
    throw new Error("Couldn't find the JSON in the pasted text. Copy the AI's whole reply and paste it again.");
  }

  const replyId = typeof parsed?.reportId === 'string' ? parsed.reportId.trim() : '';
  if (replyId && replyId !== request.reportId) {
    throw new Error('This reply is for an older prompt - bugs were added or edited since it was copied. Copy the prompt again and send it to the AI.');
  }

  const assembled = assembleBatchResult(parsed, request.labeledFeatures);
  if (assembled.matchedCount === 0) {
    throw new Error("The reply doesn't include summaries for these CUJs. Make sure you pasted the reply to the latest prompt.");
  }
  if (assembled.uncoveredCount > 0) {
    console.warn(`AI chat reply skipped ${assembled.uncoveredCount} bug(s); they were added from the raw notes.`);
  }

  return {
    overallSummary: assembled.overallSummary || request.buildOfflineOverall(),
    featureSummaries: assembled.featureSummaries,
    modelUsed: CHAT_REPLY_MODEL_LABEL
  };
}
