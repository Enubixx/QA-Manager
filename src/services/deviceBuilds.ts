import type { BuildEnvironment } from '../types';

/**
 * Bridge to the QA Tester native plugin (android/.../DeviceBuildsPlugin.java) plus local storage
 * for the glasses build captured from the Glasses Companion About screen.
 * On the web (no native app) everything degrades gracefully: phone info is null and the glasses
 * fields can be typed in manually.
 */
export interface NativePackageVersion { packageName: string; versionName?: string; versionCode?: string }
export interface PhoneBuildInfo {
  manufacturer?: string;
  model?: string;
  androidVersion?: string;
  sdkInt?: number;
  buildId?: string;
  buildDisplay?: string;
  fingerprint?: string;
  glassesCore?: NativePackageVersion;
  glassesCompanion?: NativePackageVersion;
}
export interface OcrResult { text: string; lines: { text: string; top: number; left: number; height: number }[] }
export interface GlassesBuild { firmware?: string; serial?: string; product?: string; capturedAt?: string }

const GLASSES_KEY = 'qa_glasses_build_v1';

const plugin = (): any => {
  const cap = typeof window !== 'undefined' ? (window as any).Capacitor : undefined;
  if (!cap?.isNativePlatform?.()) return null;
  try {
    return cap.Plugins?.DeviceBuilds || cap.registerPlugin?.('DeviceBuilds') || null;
  } catch {
    return null;
  }
};

export const isNativeApp = (): boolean =>
  typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.();

let phoneInfoCache: PhoneBuildInfo | null = null;
export async function getPhoneBuildInfo(): Promise<PhoneBuildInfo | null> {
  if (phoneInfoCache !== null) return phoneInfoCache;
  const p = plugin();
  if (!p?.getBuildInfo) return null;
  try {
    const info = (await p.getBuildInfo()) as PhoneBuildInfo | null;
    if (info && typeof info === 'object') phoneInfoCache = info;
    return phoneInfoCache;
  } catch {
    return null;
  }
}

/** On-device OCR of an image data URL (ML Kit, no network). Throws if unavailable. */
export async function recognizeImageText(dataUrl: string): Promise<OcrResult> {
  const p = plugin();
  if (!p?.recognizeText) throw new Error('Scanning works in the QA Tester Android app. Enter the build manually here.');
  return (await p.recognizeText({ base64: dataUrl })) as OcrResult;
}

interface StoredGlasses { current?: GlassesBuild; bySerial?: Record<string, GlassesBuild> }
const readStore = (): StoredGlasses => {
  if (typeof localStorage === 'undefined') return {};
  try {
    const v = JSON.parse(localStorage.getItem(GLASSES_KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};

export const getCurrentGlassesBuild = (): GlassesBuild | undefined => readStore().current;

export function saveGlassesBuild(build: GlassesBuild): GlassesBuild {
  const clean: GlassesBuild = {
    firmware: build.firmware?.trim() || undefined,
    serial: build.serial?.trim().toUpperCase() || undefined,
    product: build.product?.trim() || undefined,
    capturedAt: new Date().toISOString(),
  };
  const store = readStore();
  store.current = clean;
  if (clean.serial) store.bySerial = { ...(store.bySerial || {}), [clean.serial]: clean };
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(GLASSES_KEY, JSON.stringify(store));
    } catch { /* storage full - keep in memory only */ }
  }
  return clean;
}

/** Snapshot attached to each bug / run. */
export function buildEnvironment(phone: PhoneBuildInfo | null, glasses?: GlassesBuild): BuildEnvironment | undefined {
  const env: BuildEnvironment = {
    phoneManufacturer: phone?.manufacturer || undefined,
    phoneModel: phone?.model || undefined,
    androidVersion: phone?.androidVersion || undefined,
    phoneBuild: phone?.buildId || undefined,
    glassesCoreVersion: phone?.glassesCore?.versionName || undefined,
    glassesCompanionVersion: phone?.glassesCompanion?.versionName || undefined,
    glassesFirmware: glasses?.firmware || undefined,
    glassesSerial: glasses?.serial || undefined,
    glassesProduct: glasses?.product || undefined,
    glassesCapturedAt: glasses?.capturedAt || undefined,
  };
  const hasAny = Object.values(env).some(Boolean);
  return hasAny ? { ...env, capturedAt: new Date().toISOString() } : undefined;
}

/** Reads a picked image file as a data URL. */
export const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('Could not read the image'));
    r.readAsDataURL(file);
  });
