import { Platform } from 'react-native';

/**
 * Whether the app may show plans, prices and "upgrade" buttons.
 *
 * iOS: App Store guideline 3.1.1 forbids selling digital plans outside in-app purchase and
 * pointing users to buy them elsewhere, so the iOS app shows neither (it stays a companion to
 * the web plans, 3.1.3(f): users who bought a plan on the website get it here). Android is
 * unchanged: every caller keeps its existing UI and wording when this returns true.
 */
export function canShowPurchaseOptions(): boolean {
  return Platform.OS !== 'ios';
}
