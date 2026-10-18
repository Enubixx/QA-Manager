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
  'system': 'ignore',
  'battery': 'ignore',
  'status': 'ignore',
  'bluetooth': 'ignore',
};

/** A value plus at most two wrapped continuation lines. */
const MAX_VALUE_LINES = 3;
/** The About screen is short; never regex-scan more than this when falling back. */
const MAX_FALLBACK_CHARS = 4000;
/** Raw line length above which a pure label line can't be a label (labels normalize to <= 20 chars). */
const MAX_LABEL_LINE_CHARS = 40;
/** Labels normalize to at most this many characters. */
const MAX_LABEL_CHARS = 20;

const isSpaceCode = (c: number): boolean =>
  c === 32 || c === 9 || c === 160 || (c >= 0x2000 && c <= 0x200a);

/**
 * Lowercase, keep only a-z and single spaces (handling spaces, tabs, NBSP), trim.
 * Avoids regexes on every OCR line so large noisy inputs stay fast.
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
    } else if (isSpaceCode(c)) {
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
const FIRMWARE_RE = /([A-Za-z0-9]{3,5})\s*[.,]\s*([0-9OoIilL|SsBb]{6})\s*[.,]\s*([0-9OoIilL|SsBb]{3})(?:\s*\(\s*([A-Za-z0-9_.\-]{1,32})\s*\)?)?/;

export function normalizeFirmware(raw: string): { value?: string; ambiguous: boolean } {
  // Collapse wrapped lines inside parentheses e.g. "(O20XX\nUEU1AZJ5)" -> "(O20XXUEU1AZJ5)"
  const collapsedParens = (raw || '').replace(
    /\(\s*([A-Za-z0-9_.\-]+(?:\s*\r?\n\s*[A-Za-z0-9_.\-]+)+)\s*\)?/g,
    (_, inner: string) => `(${inner.replace(/\s+/g, '')})`
  );
  const m = collapsedParens.replace(/\s+/g, ' ').match(FIRMWARE_RE);
  if (!m) return { value: undefined, ambiguous: true };
  const head = m[1].toUpperCase();
  // Build-id prefix like "BGH4" or "ABCO1": letters then a final digit - only swap O->0 on the final char
  const fixedHead = /^[A-Z0-9]{3,4}[A-Z0-9]$/.test(head)
    ? head.slice(0, -1).replace(/0/g, 'O') + head.slice(-1).replace(/O/g, '0')
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

/** Subtitles / status noise that appear beneath fields in the Companion app and are not continuations. */
const NOISE_SUBTITLE_RE = /^(?:up\s*to\s*date|update\s*available|installed|connected|disconnected|connecting|not\s*connected|charging|paired|unpaired|battery\b.*|\d{1,3}%)$/i;

/** Strip trailing status subtitles if OCR merged them onto the same line as a version. */
const stripVersionSubtitle = (s: string): string =>
  s.replace(/\s*(?:up\s*to\s*date|update\s*available|installed|connected|disconnected)\s*$/i, '').trim();

const isContinuationAllowed = (field: keyof AboutParse, prev: string, next: string): boolean => {
  if (NOISE_SUBTITLE_RE.test(next)) return false;
  if (field === 'serial') {
    // Only allow a continuation line for serial if `prev` was just the "Glasses:" prefix or ended with a hyphen
    const stripped = prev.replace(/^\s*glasses\s*[:;]?\s*/i, '').trim();
    if (!stripped) return true;
    if (prev.endsWith('-') && /^[A-Za-z0-9]{1,12}$/.test(next)) return true;
    return false;
  }
  if (field === 'coreVersion' || field === 'companionVersion') {
    // Version continuations must be a single token with digits/punctuation, never multi-word prose like "Up to date"
    if (/\s/.test(next)) return false;
    if (/^[A-Za-z]+$/.test(next)) return false;
    return /^[A-Za-z0-9_.\-+]+$/.test(next);
  }
  if (field === 'firmware') {
    // Allow wrapped variant lines when '(' is still open, or a parenthesized "(VARIANT)" on the next line
    if (prev.includes('(') && !prev.includes(')')) return /^[A-Za-z0-9_.\-)\s]+$/.test(next);
    if (/^\([A-Za-z0-9_.\-\s]+\)?$/.test(next)) return true;
    if (!normalizeFirmware(prev).value) return true;
    return false;
  }
  return true;
};

const shouldJoinWithoutSpace = (field: keyof AboutParse, prev: string, next: string): boolean => {
  if (field === 'coreVersion' || field === 'companionVersion' || field === 'serial') return true;
  if (field === 'firmware' && prev.includes('(') && !prev.includes(')')) return true;
  // For product / model, "Ray-Ban" + "Meta" is two words (join with space); only join without space on trailing '_' or '.'
  if (field === 'product' || field === 'model') {
    return /[_.]/.test(prev.slice(-1));
  }
  if (/[_.\-]$/.test(prev) || /^[_.\-]/.test(next)) return true;
  const lastToken = prev.split(/\s+/).pop() || '';
  if (/[0-9_.]/.test(lastToken) && /^[A-Za-z0-9_.\-]+$/.test(next) && /[0-9_.]/.test(next)) return true;
  return false;
};

export function parseGlassesAbout(input: string | OcrLine[]): AboutParse {
  const lines = toLines(input);
  const values: Partial<Record<keyof AboutParse, string>> = {};
  let earlyFirmware = '';
  let current: keyof AboutParse | 'ignore' | null = null;
  let seenGlassesSection = false;
  // Value lines taken for the current label occurrence (first line + wrapped continuations).
  let taken = 0;
  // Fields already filled by an earlier occurrence of their label (e.g. the screen scanned twice).
  const done = new Set<keyof AboutParse>();

  const recordValueLine = (valLine: string) => {
    if (!valLine || !current || current === 'ignore' || current === 'needsReview') return;
    if (done.has(current)) return;
    if (taken >= MAX_VALUE_LINES) return;
    if (current === 'firmware' && !seenGlassesSection && !values.serial && !values.product) {
      if (!earlyFirmware || isContinuationAllowed('firmware', earlyFirmware, valLine)) {
        taken++;
        earlyFirmware = earlyFirmware
          ? `${earlyFirmware}${shouldJoinWithoutSpace('firmware', earlyFirmware, valLine) ? '' : ' '}${valLine}`
          : valLine;
      }
      return;
    }
    const prev = values[current];
    if (prev && !isContinuationAllowed(current, prev, valLine)) {
      done.add(current);
      return;
    }
    if (!prev && NOISE_SUBTITLE_RE.test(valLine)) return;
    taken++;
    values[current] = prev ? `${prev}${shouldJoinWithoutSpace(current, prev, valLine) ? '' : ' '}${valLine}` : valLine;
  };

  for (const line of lines) {
    const norm = labelOf(line);
    const label = norm ? LABELS[norm] : undefined;
    if (label !== undefined && norm.length <= MAX_LABEL_CHARS) {
      if (norm === 'glasses' || norm === 'product' || norm === 'serial number') seenGlassesSection = true;
      if (current && current !== 'ignore' && values[current]) done.add(current);
      current = label;
      taken = 0;
      continue;
    }

    // Check single-line "Label: value" (e.g. "Serial number: R4AL4003J0B", "Version: BGH4.260901.003")
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0 && colonIdx <= MAX_LABEL_LINE_CHARS) {
      const prefixNorm = labelOf(line.slice(0, colonIdx));
      const inlineLabel = prefixNorm ? LABELS[prefixNorm] : undefined;
      if (inlineLabel && inlineLabel !== 'ignore' && prefixNorm.length <= MAX_LABEL_CHARS) {
        if (prefixNorm === 'product' || prefixNorm === 'serial number') seenGlassesSection = true;
        if (current && current !== 'ignore' && values[current]) done.add(current);
        current = inlineLabel;
        taken = 0;
        const remainder = line.slice(colonIdx + 1).trim();
        if (remainder) recordValueLine(remainder);
        continue;
      }
    }

    recordValueLine(line);
  }

  const needsReview: string[] = [];
  const out: AboutParse = { needsReview };

  // Firmware: labelled value, else early Version block, else anywhere in the text that looks like a build id
  let fw = normalizeFirmware(values.firmware || earlyFirmware || '');
  if (!fw.value) {
    // Fallback: search the Glasses section first, then all lines if not found
    const start = lines.findIndex(l => ['glasses', 'serial number', 'product'].includes(labelOf(l)));
    fw = normalizeFirmware((start >= 0 ? lines.slice(start) : lines).join(' ').slice(0, MAX_FALLBACK_CHARS));
    if (!fw.value && start > 0) {
      fw = normalizeFirmware(lines.join(' ').slice(0, MAX_FALLBACK_CHARS));
    }
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
  if (values.coreVersion) {
    const cleanedCore = stripVersionSubtitle(values.coreVersion).replace(/\s+/g, '');
    if (cleanedCore && /\d/.test(cleanedCore)) out.coreVersion = cleanedCore;
  }
  if (values.companionVersion) {
    const cleanedComp = stripVersionSubtitle(values.companionVersion).replace(/\s+/g, '');
    if (cleanedComp && /\d/.test(cleanedComp)) out.companionVersion = cleanedComp;
  }
  return out;
}
