import React, { useEffect, useRef, useState } from 'react';
import { Glasses, ScanLine, Pencil, CheckCircle2, AlertTriangle } from 'lucide-react';
import {
  type GlassesBuild,
  type PhoneBuildInfo,
  fileToDataUrl,
  getCurrentGlassesBuild,
  getPhoneBuildInfo,
  isNativeApp,
  recognizeImageText,
  saveGlassesBuild,
} from '../services/deviceBuilds';
import { parseGlassesAbout } from '../utils/glassesAboutParser';

/**
 * Session-setup card: shows the phone/app builds read automatically and lets the tester capture the
 * glasses firmware by scanning a screenshot of Glasses Companion > System > About (on-device OCR),
 * then confirm/edit before saving. Saved builds are attached to every bug in the session.
 */
interface Props {
  onChange?: (build: GlassesBuild | undefined, phone: PhoneBuildInfo | null) => void;
}

const field = 'w-full bg-zinc-900/80 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-sky-500';

export default function GlassesBuildCapture({ onChange }: Props) {
  const [phone, setPhone] = useState<PhoneBuildInfo | null>(null);
  const [saved, setSaved] = useState<GlassesBuild | undefined>(() => getCurrentGlassesBuild());
  const [draft, setDraft] = useState<GlassesBuild | null>(null);
  const [review, setReview] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const native = isNativeApp();

  useEffect(() => {
    let alive = true;
    getPhoneBuildInfo().then(info => {
      if (!alive) return;
      setPhone(info);
      onChange?.(getCurrentGlassesBuild(), info);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      const ocr = await recognizeImageText(dataUrl);
      const parsed = parseGlassesAbout(ocr.lines?.length ? ocr.lines : ocr.text);
      if (!parsed.firmware && !parsed.serial) {
        setError("Couldn't find the glasses Version on that image. Make sure it's the Glasses Companion > System > About screen, or enter it below.");
      }
      setDraft({ firmware: parsed.firmware || '', serial: parsed.serial || '', product: parsed.product || saved?.product || '' });
      setReview(parsed.needsReview);
    } catch (err: any) {
      setError(err?.message || 'Could not read the screenshot.');
      setDraft({ ...(saved || {}) });
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (!draft) return;
    const next = saveGlassesBuild(draft);
    setSaved(next);
    setDraft(null);
    setReview([]);
    setError(null);
    onChange?.(next, phone);
  };

  const ago = (iso?: string) => {
    if (!iso) return '';
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const h = Math.round(mins / 60);
    return h < 48 ? `${h} h ago` : new Date(iso).toLocaleDateString();
  };

  return (
    <div className="p-3.5 bg-zinc-900/60 border border-zinc-800 rounded-2xl space-y-2.5 text-left" data-testid="glasses-build-capture">
      <div className="flex items-center gap-2">
        <Glasses className="w-4 h-4 text-sky-400" />
        <span className="text-xs font-bold text-white">Glasses build</span>
        {saved?.firmware && !draft && <span className="ml-auto text-[10px] text-zinc-400">captured {ago(saved.capturedAt)}</span>}
      </div>

      {!draft && (
        saved?.firmware ? (
          <div className="text-[11px] font-mono text-zinc-200 leading-relaxed" data-testid="glasses-build-saved">
            <div><span className="text-zinc-500">Version </span>{saved.firmware}</div>
            {saved.serial && <div><span className="text-zinc-500">Serial </span>{saved.serial}</div>}
          </div>
        ) : (
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            Open <b className="text-zinc-200">Glasses Companion → System → About</b>, take a screenshot, then tap <b className="text-zinc-200">Scan</b>.
          </p>
        )
      )}

      {draft && (
        <div className="space-y-2" data-testid="glasses-build-confirm">
          <p className="text-[11px] text-zinc-400">Check these match the About screen, then save.</p>
          {(['firmware', 'serial', 'product'] as const).map(k => (
            <label key={k} className="block">
              <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-zinc-500 mb-0.5">
                {k === 'firmware' ? 'Version (firmware)' : k === 'serial' ? 'Serial number' : 'Product'}
                {review.includes(k) && <span className="text-amber-300 normal-case tracking-normal flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" />check O vs 0, I vs 1</span>}
              </span>
              <input aria-label={k} className={`${field} ${review.includes(k) ? 'border-amber-500/60' : ''}`} value={draft[k] || ''}
                onChange={e => setDraft({ ...draft, [k]: e.target.value })} />
            </label>
          ))}
        </div>
      )}

      {error && <p className="text-[11px] text-amber-300 leading-snug">{error}</p>}

      <div className="flex gap-2">
        {!draft ? (
          <>
            <button type="button" disabled={busy || !native} onClick={() => fileRef.current?.click()} data-testid="scan-about"
              className="flex-1 py-2 rounded-xl text-xs font-semibold bg-sky-600/80 hover:bg-sky-500 text-white disabled:opacity-40 flex items-center justify-center gap-1.5">
              <ScanLine className="w-3.5 h-3.5" /> {busy ? 'Reading…' : saved?.firmware ? 'Rescan' : 'Scan'}
            </button>
            <button type="button" onClick={() => { setDraft({ ...(saved || {}) }); setReview([]); }} data-testid="edit-glasses-build"
              className="px-3 py-2 rounded-xl text-xs text-zinc-300 bg-zinc-800 hover:bg-zinc-700 flex items-center gap-1.5">
              <Pencil className="w-3.5 h-3.5" /> {saved?.firmware ? 'Edit' : 'Enter'}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={confirm} data-testid="save-glasses-build"
              className="flex-1 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> Save build
            </button>
            <button type="button" onClick={() => { setDraft(null); setReview([]); setError(null); }}
              className="px-3 py-2 rounded-xl text-xs text-zinc-300 bg-zinc-800 hover:bg-zinc-700">Cancel</button>
          </>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPick} data-testid="about-file" />

      {phone && (
        <div className="pt-1.5 border-t border-zinc-800 text-[10px] font-mono text-zinc-500 leading-relaxed break-all" data-testid="phone-builds">
          <div>{[phone.manufacturer, phone.model].filter(Boolean).join(' ')} · Android {phone.androidVersion} · {phone.buildId}</div>
          <div>Core {phone.glassesCore?.versionName || 'not installed'}</div>
          <div>Companion {phone.glassesCompanion?.versionName || 'not installed'}</div>
        </div>
      )}
      {!native && <p className="text-[10px] text-zinc-500">Scanning and automatic phone builds work in the QA Tester Android app.</p>}
    </div>
  );
}
