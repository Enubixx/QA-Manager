import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

export type HapticFeedbackType =
  | 'soft'
  | 'selection'
  | 'light'
  | 'medium'
  | 'heavy'
  | 'success'
  | 'warning'
  | 'error';

/**
 * Universal haptics trigger combining native Capacitor Haptics
 * with HTML5 Navigator Vibrate fallback for 100% reliable physical feedback on mobile.
 */
export const triggerHaptic = (type: HapticFeedbackType = 'light') => {
  // 1. Trigger Capacitor Native Haptics
  try {
    if (type === 'soft' || type === 'selection') {
      Haptics.selectionStart().catch(() => {});
      Haptics.selectionChanged().catch(() => {});
    } else if (type === 'light') {
      Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    } else if (type === 'medium') {
      Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
    } else if (type === 'heavy') {
      Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
    } else if (type === 'success') {
      Haptics.notification({ type: NotificationType.Success }).catch(() => {});
    } else if (type === 'warning') {
      Haptics.notification({ type: NotificationType.Warning }).catch(() => {});
    } else if (type === 'error') {
      Haptics.notification({ type: NotificationType.Error }).catch(() => {});
    }
  } catch (e) {}

  // 2. Trigger HTML5 Navigator Vibrate (supported natively by Android Chromium WebView)
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      switch (type) {
        case 'soft':
        case 'selection':
          navigator.vibrate(28);
          break;
        case 'light':
          navigator.vibrate(45);
          break;
        case 'medium':
          navigator.vibrate(70);
          break;
        case 'heavy':
          navigator.vibrate(95);
          break;
        case 'success':
          // Rich, celebratory multi-pulse for finished test session
          navigator.vibrate([60, 60, 90, 60, 160]);
          break;
        case 'warning':
          navigator.vibrate([40, 50, 40]);
          break;
        case 'error':
          navigator.vibrate([70, 60, 70]);
          break;
      }
    }
  } catch (e) {}
};
