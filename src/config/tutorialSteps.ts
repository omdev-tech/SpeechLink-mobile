import { canShowPurchaseOptions } from './purchases';

export type TutorialStepId = 
  | 'welcome'
  | 'createSentence'
  | 'categoryButton'
  | 'selectCategory'
  | 'organizeSentences'
  | 'voiceCollection'
  | 'pronunciation'
  | 'settingsLanguage'
  | 'settingsAudioOutput'
  | 'settingsHideDefaults'
  | 'settingsDiscord'
  | 'settingsSubscription'
  | 'complete';

export type TutorialTargetScreen = 
  | 'AACBoard'
  | 'VoiceCollection'
  | 'Dictionary'
  | 'Settings'
  | 'None';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right' | 'center';

export interface TutorialStep {
  id: TutorialStepId;
  targetScreen: TutorialTargetScreen;
  targetId?: string; // ID of the element to highlight
  titleKey: string; // i18n key for title
  messageKey: string; // i18n key for message
  placement: TooltipPlacement;
  requiresNavigation: boolean; // Does this step need to navigate to a different tab?
}

const ALL_TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    targetScreen: 'None',
    titleKey: 'tutorial.welcome.title',
    messageKey: 'tutorial.welcome.message',
    placement: 'center',
    requiresNavigation: false,
  },
  {
    id: 'createSentence',
    targetScreen: 'AACBoard',
    targetId: 'aac-add-sentence-button',
    titleKey: 'tutorial.steps.createSentence.title',
    messageKey: 'tutorial.steps.createSentence.message',
    placement: 'bottom',
    requiresNavigation: true, // Navigate to AACBoard when coming from welcome or other screens
  },
  {
    id: 'categoryButton',
    targetScreen: 'AACBoard',
    targetId: 'aac-category-selector',
    titleKey: 'tutorial.steps.categoryButton.title',
    messageKey: 'tutorial.steps.categoryButton.message',
    placement: 'bottom',
    requiresNavigation: false, // Already on AACBoard from previous step
  },
  {
    id: 'selectCategory',
    targetScreen: 'AACBoard',
    targetId: 'aac-categories-list',
    titleKey: 'tutorial.steps.selectCategory.title',
    messageKey: 'tutorial.steps.selectCategory.message',
    placement: 'bottom',
    requiresNavigation: false,
  },
  {
    id: 'organizeSentences',
    targetScreen: 'AACBoard',
    targetId: 'aac-reorder-button',
    titleKey: 'tutorial.steps.organizeSentences.title',
    messageKey: 'tutorial.steps.organizeSentences.message',
    placement: 'bottom',
    requiresNavigation: false,
  },
  {
    id: 'voiceCollection',
    targetScreen: 'VoiceCollection',
    targetId: 'voice-collection-container',
    titleKey: 'tutorial.steps.voiceCollection.title',
    messageKey: 'tutorial.steps.voiceCollection.message',
    placement: 'center',
    requiresNavigation: true,
  },
  {
    id: 'pronunciation',
    targetScreen: 'Dictionary',
    targetId: 'dictionary-add-button',
    titleKey: 'tutorial.steps.pronunciation.title',
    messageKey: 'tutorial.steps.pronunciation.message',
    placement: 'bottom',
    requiresNavigation: true,
  },
  {
    id: 'settingsLanguage',
    targetScreen: 'Settings',
    targetId: 'settings-language',
    titleKey: 'tutorial.steps.settingsLanguage.title',
    messageKey: 'tutorial.steps.settingsLanguage.message',
    placement: 'bottom',
    requiresNavigation: true,
  },
  {
    id: 'settingsAudioOutput',
    targetScreen: 'Settings',
    targetId: 'settings-audio-output',
    titleKey: 'tutorial.steps.settingsAudioOutput.title',
    messageKey: 'tutorial.steps.settingsAudioOutput.message',
    placement: 'bottom',
    requiresNavigation: false,
  },
  {
    id: 'settingsHideDefaults',
    targetScreen: 'Settings',
    targetId: 'settings-hide-defaults',
    titleKey: 'tutorial.steps.settingsHideDefaults.title',
    messageKey: 'tutorial.steps.settingsHideDefaults.message',
    placement: 'bottom',
    requiresNavigation: false,
  },
  {
    id: 'settingsDiscord',
    targetScreen: 'Settings',
    targetId: 'settings-discord',
    titleKey: 'tutorial.steps.settingsDiscord.title',
    messageKey: 'tutorial.steps.settingsDiscord.message',
    placement: 'bottom',
    requiresNavigation: false,
  },
  {
    id: 'settingsSubscription',
    targetScreen: 'Settings',
    targetId: 'settings-subscription',
    titleKey: 'tutorial.steps.settingsSubscription.title',
    messageKey: 'tutorial.steps.settingsSubscription.message',
    placement: 'bottom',
    requiresNavigation: false,
  },
  {
    id: 'complete',
    targetScreen: 'None',
    titleKey: 'tutorial.complete.title',
    messageKey: 'tutorial.complete.message',
    placement: 'center',
    requiresNavigation: false,
  },
];

// The subscription step points at the Settings "Subscription" row, which iOS does not show.
export const TUTORIAL_STEPS: TutorialStep[] = ALL_TUTORIAL_STEPS.filter(
  (step) => canShowPurchaseOptions() || step.id !== 'settingsSubscription'
);
