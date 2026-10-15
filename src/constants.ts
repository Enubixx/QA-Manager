// App Version Constants for Mobile APK and Server Compatibility Enforcement
export const APP_VERSION_CODE = 7;
export const APP_VERSION_NAME = '2.5.0';

// Version options for minimum APK version selector and display formatting
export const APP_VERSION_OPTIONS: { code: number; version: string; label: string }[] = [
  { code: 1, version: '1.0.0', label: 'v1.0.0 (Code 1)' },
  { code: 2, version: '2.0.0', label: 'v2.0.0 (Code 2)' },
  { code: 3, version: '2.1.0', label: 'v2.1.0 (Code 3)' },
  { code: 4, version: '2.2.0', label: 'v2.2.0 (Code 4)' },
  { code: 5, version: '2.3.0', label: 'v2.3.0 (Code 5)' },
  { code: 6, version: '2.4.0', label: 'v2.4.0 (Code 6)' },
  { code: 7, version: '2.5.0', label: 'v2.5.0 (Code 7 - Latest)' },
];

export const formatAppVersionName = (code: number): string => {
  const found = APP_VERSION_OPTIONS.find(o => o.code === Number(code));
  if (found) return `v${found.version}`;
  return `v2.${Math.max(0, Number(code) - 2)}.0`;
};

// Config identifiers stored in Supabase / LocalStorage
export const CONFIG_MIN_APP_VERSION = '__APP_MIN_VERSION__';
export const CONFIG_DAILY_RESET_DATE = '__DAILY_QUOTA_RESET_DATE__';
