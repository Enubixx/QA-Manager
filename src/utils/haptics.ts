import { Capacitor } from '@capacitor/core';
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
 * Keyboard-like haptics trigger:
 * Delivers the sharp, crisp, mechanical tick of typing on a mobile keyboard (like Gboard).
 */
export const triggerHaptic = (type: HapticFeedbackType = 'light') => {
  // 1. Native Capacitor Haptics (uses Android's native KEYBOARD_TAP / EFFECT_CLICK)
  if (Capacitor.isNativePlatform()) {
    try {
      if (type === 'soft' || type === 'selection' || type === 'light' || type === 'medium') {
        // Exact Android keyboard keypress click
        Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
      } else if (type === 'heavy') {
        Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
      } else if (type === 'success') {
        Haptics.notification({ type: NotificationType.Success }).catch(() => {});
      } else if (type === 'warning') {
        Haptics.notification({ type: NotificationType.Warning }).catch(() => {});
      } else if (type === 'error') {
        Haptics.notification({ type: NotificationType.Error }).catch(() => {});
      }
      return;
    } catch (e) {}
  }

  // 2. HTML5 Navigator Vibrate fallback with ultra-tight keyboard-tick durations
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      switch (type) {
        case 'soft':
        case 'selection':
        case 'light':
        case 'medium':
          navigator.vibrate(10);
          break;
        case 'heavy':
          navigator.vibrate(26);
          break;
        case 'success':
          // Rapid, snappy keyboard multi-tap sequence
          navigator.vibrate([10, 35, 14, 35, 18]);
          break;
        case 'warning':
          navigator.vibrate([12, 30, 12]);
          break;
        case 'error':
          navigator.vibrate([16, 30, 16]);
          break;
      }
    }
  } catch (e) {}
};
