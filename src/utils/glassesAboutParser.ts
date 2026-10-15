/**
 * Parses text read (OCR) from the Glasses Companion "System > About" screen.
 *
 * Layout (Oct 2026 build):
 *   Phone:    Glasses Core / <version>, Glasses app / <version>
 *   Glasses:  Product / <name>, Model / <name or empty>, Serial number / "Glasses: <serial>",
 *             Version / "<BUILD_ID> (<variant>)", Connection / <state>
 *
 * OCR commonly confuses O/0 and I/l/1, and wraps long values across lines - both are handled
 * where the format allows it, and anything that can't be verified is flagged for review.
 */
export interface AboutParse {
  firmware?: string;
  serial?: string;
  product?: string;
  model?: string;
  coreVersion?: string;
  companionVersion?: string;
  /** Field names the tester should double-check (ambiguous characters or not found). */
  needsReview: string[];
}

export interface OcrLine { text: string; top?: number; left?: number }

const LABELS: Record<string, keyof AboutParse | 'ignore'> = {
  'glasses core': 'coreVersion',
  'glasses app': 'companionVersion',
  'glasses companion': 'companionVersion',
  'product': 'product',
  'model': 'model',
  'serial number': 'serial',
  'version': 'firmware',
  'connection': 'ignore',
  'phone': 'ignore',
  'glasses': 'ignore',
  'about': 'ignore',
};

/** A value plus at most two wrapped continuation lines. */
const MAX_VALUE_LINES = 3;
/** The About screen is short; never regex-scan more than this when falling back. */
const MAX_FALLBACK_CHARS = 4000;
/** Raw line length above which a line can't be a label (labels normalize to <= 20 chars). */
const MAX_LABEL_LINE_CHARS = 40;
/** Labels normalize to at most this many characters. */
const MAX_LABEL_CHARS = 20;

/**
 * Lowercase, keep only a-z and single spaces, trim. Same result as
 * `s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()` but without regexes,
 * since it runs on every OCR line (large noisy inputs must stay fast).
 */
const normLabel = (s: string) => {
  let out = '';
  let space = false;
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 65 && c <= 90) c += 32; // A-Z -> a-z
    if (c >= 97 && c <= 122) {
      if (space && out) out += ' ';
      space = false;
      out += String.fromCharCode(c);
      if (out.length > MAX_LABEL_CHARS) return out; // too long to be a label; stop early
    } else if (c === 32) {
      space = true;
    }
  }
  return out;
};

/** Normalized label for short lines only; long lines (values, log noise) are never labels. */
const labelOf = (s: string) => (s.length <= MAX_LABEL_LINE_CHARS ? normLabel(s) : '');

/** Fix OCR letter/digit swaps inside a run that must be digits. */
const toDigits = (s: string) => s.replace(/[Oo]/g, '0').replace(/[IilL|]/g, '1').replace(/[Ss]/g, '5').replace(/[Bb]/g, '8');

/** "BGH4.260901.003 (O20XXUEU1AZJ5)" - Android build id + optional variant in parentheses. */
const FIRMWARE_RE = /([A-Za-z0-9]{3,5})\s*[.,]\s*([0-9OoIilL|SsBb]{6})\s*[.,]\s*([0-9OoIilL|SsBb]{3})(?:\s*\(\s*([A-Za-z0-9]{5,24})\s*\)?)?/;

export function normalizeFirmware(raw: string): { value?: string; ambiguous: boolean } {
  const m = (raw || '').replace(/\s+/g, ' ').match(FIRMWARE_RE);
  if (!m) return { value: undefined, ambiguous: true };
  const head = m[1].toUpperCase();
  // Build-id prefix like "BGH4": letters then a digit - fix O/0 swaps by position
  const fixedHead = /^[A-Z0-9]{3}[A-Z0-9]$/.test(head)
    ? head.slice(0, 3).replace(/0/g, 'O') + head.slice(3).replace(/O/g, '0')
    : head;
  const id = `${fixedHead}.${toDigits(m[2])}.${toDigits(m[3])}`;
  const variant = m[4]?.toUpperCase();
  // O vs 0 and I vs 1 can't be told apart reliably in the free-form variant - flag for review
  const ambiguous = !!variant && /[0O1I]/.test(variant);
  return { value: variant ? `${id} (${variant})` : id, ambiguous };
}

function toLines(input: string | OcrLine[]): string[] {
  if (typeof input === 'string') return input.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return [...input]
    .sort((a, b) => (a.top ?? 0) - (b.top ?? 0) || (a.left ?? 0) - (b.left ?? 0))
    .map(l => (l.text || '').trim())
    .filter(Boolean);
}

export function parseGlassesAbout(input: string | OcrLine[]): AboutParse {
  const lines = toLines(input);
  const values: Partial<Record<keyof AboutParse, string>> = {};
  let current: keyof AboutParse | 'ignore' | null = null;
  let seenGlassesSection = false;
  // Value lines taken for the current label occurrence (first line + wrapped continuations).
  let taken = 0;
  // Fields already filled by an earlier occurrence of their label (e.g. the screen scanned twice).
  const done = new Set<keyof AboutParse>();

  for (const line of lines) {
    const norm = labelOf(line);
    const label = norm ? LABELS[norm] : undefined;
    if (label !== undefined && norm.length <= MAX_LABEL_CHARS) {
      if (norm === 'glasses') seenGlassesSection = true;
      if (current && current !== 'ignore' && values[current]) done.add(current);
      current = label;
      taken = 0;
      continue;
    }
    if (!current || current === 'ignore' || current === 'needsReview') continue;
    // Only accept "Version" from the Glasses section (after "Serial number" / "Glasses")
    if (current === 'firmware' && !seenGlassesSection && !values.serial) continue;
    // A repeated label never appends to (or overwrites) the value from its first occurrence
    if (done.has(current)) continue;
    // Bound wrapping so trailing noise/log lines can't grow a value without limit
    if (taken >= MAX_VALUE_LINES) continue;
    taken++;
    const prev = values[current];
    // Long values wrap: join continuation lines without a space (e.g. "..._R" + "C000")
    values[current] = prev ? `${prev}${/[_.\-]$/.test(prev) || /^[_.\-A-Za-z0-9]{1,12}$/.test(line) ? '' : ' '}${line}` : line;
  }

  const needsReview: string[] = [];
  const out: AboutParse = { needsReview };

  // Firmware: labelled value, else anywhere in the text that looks like a build id
  let fw = normalizeFirmware(values.firmware || '');
  if (!fw.value) {
    // Fallback: search only the Glasses section (never the Phone section's builds)
    const start = lines.findIndex(l => ['glasses', 'serial number', 'product'].includes(labelOf(l)));
    fw = normalizeFirmware((start >= 0 ? lines.slice(start) : lines).join(' ').slice(0, MAX_FALLBACK_CHARS));
  }
  if (fw.value) out.firmware = fw.value;
  if (!fw.value || fw.ambiguous) needsReview.push('firmware');

  if (values.serial) {
    const serial = values.serial.replace(/^\s*glasses\s*[:;]\s*/i, '').replace(/\s+/g, '').toUpperCase();
    if (/^[A-Z0-9]{6,20}$/.test(serial)) out.serial = serial;
    if (!out.serial || /[0O1I]/.test(serial)) needsReview.push('serial');
  } else {
    needsReview.push('serial');
  }

  if (values.product) out.product = values.product.trim();
  if (values.model && !LABELS[normLabel(values.model)]) out.model = values.model.trim();
  if (values.coreVersion) out.coreVersion = values.coreVersion.replace(/\s+/g, '');
  if (values.companionVersion) out.companionVersion = values.companionVersion.replace(/\s+/g, '');
  return out;
}
