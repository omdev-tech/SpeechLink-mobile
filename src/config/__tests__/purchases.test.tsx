jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialIcons: () => null }));

import React from 'react';
import { Platform } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { canShowPurchaseOptions } from '../purchases';
import { UpgradePrompt } from '../../components/UI/UpgradePrompt';
import { CreditLimitModal } from '../../components/UI/CreditLimitModal';

const osDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS')!;
const setOS = (os: 'ios' | 'android') =>
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });

afterEach(() => Object.defineProperty(Platform, 'OS', osDescriptor));

describe('purchase options per platform (App Store 3.1.1)', () => {
  it('are hidden on iOS and shown on Android', () => {
    setOS('ios');
    expect(canShowPurchaseOptions()).toBe(false);
    setOS('android');
    expect(canShowPurchaseOptions()).toBe(true);
  });

  describe('UpgradePrompt', () => {
    const props = { title: 'Premium Voice', message: 'Upgrade now to unlock', ctaText: 'View Plans' };

    it('Android: unchanged (caller copy + View Plans button)', () => {
      setOS('android');
      render(<UpgradePrompt {...props} />);
      expect(screen.getByText('Premium Voice')).toBeTruthy();
      expect(screen.getByText('Upgrade now to unlock')).toBeTruthy();
      expect(screen.getByText('View Plans')).toBeTruthy();
    });

    it('iOS: neutral copy, no button, no upgrade wording', () => {
      setOS('ios');
      render(<UpgradePrompt {...props} />);
      expect(screen.getByText('purchases.ios.notInPlan')).toBeTruthy();
      expect(screen.queryByText('View Plans')).toBeNull();
      expect(screen.queryByText('Upgrade now to unlock')).toBeNull();
    });
  });

  describe('CreditLimitModal', () => {
    it('Android: unchanged (indie message, Upgrade Plan, Maybe Later)', () => {
      setOS('android');
      render(<CreditLimitModal visible onClose={jest.fn()} />);
      expect(screen.getByText('subscription.indieDevMessage')).toBeTruthy();
      expect(screen.getByText('subscription.upgrade')).toBeTruthy();
      expect(screen.getByText('subscription.later')).toBeTruthy();
    });

    it('iOS: says credits are used up, with only an OK button', () => {
      setOS('ios');
      render(<CreditLimitModal visible onClose={jest.fn()} />);
      expect(screen.getByText('subscription.noCreditsMessage')).toBeTruthy();
      expect(screen.queryByText('subscription.indieDevMessage')).toBeNull();
      expect(screen.queryByText('subscription.upgrade')).toBeNull();
      expect(screen.getByText('general.ok')).toBeTruthy();
    });
  });

  it('the tutorial skips the subscription step on iOS only', () => {
    const steps = (os: 'ios' | 'android') => {
      let ids: string[] = [];
      jest.isolateModules(() => {
        // isolateModules loads its own react-native: set the platform on that copy.
        Object.defineProperty(require('react-native').Platform, 'OS', { configurable: true, get: () => os });
        ids = require('../tutorialSteps').TUTORIAL_STEPS.map((s: { id: string }) => s.id);
      });
      return ids;
    };
    expect(steps('android')).toContain('settingsSubscription');
    const ios = steps('ios');
    expect(ios).not.toContain('settingsSubscription');
    expect(ios).toContain('complete');
  });
});
