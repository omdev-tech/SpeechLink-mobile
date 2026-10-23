jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) }));
jest.mock('../../../../services/aacService', () => ({ aacService: { createSentence: jest.fn(), updateSentence: jest.fn() } }));
jest.mock('../../../../components/AAC/IconPicker', () => ({ IconPicker: () => null }));
jest.mock('../../../../components/AAC/ColorPicker', () => ({ ColorPicker: () => null }));
jest.mock('../../../../components/EmotionalTagSelector', () => ({ EmotionalTagSelector: () => null }));

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import SentenceFormModal from '../SentenceFormModal';

const renderModal = () =>
  render(
    <SentenceFormModal
      visible
      onClose={jest.fn()}
      onSave={jest.fn()}
      categories={[{ id: 'c1', name: 'Daily', color: '#8B5CF6', icon: 'chatbubble-outline' } as any]}
      currentLanguage="en"
    />
  );

describe('SentenceFormModal', () => {
  it('accepts sentences up to 5000 characters', () => {
    renderModal();
    expect(screen.getByPlaceholderText('aacBoard.enterPhraseText').props.maxLength).toBe(5000);
    expect(screen.getByText('0/5000')).toBeTruthy();
  });

  it('keeps the Cancel/Save bar above the home indicator', () => {
    renderModal();
    let footer: any = screen.getByText('general.save');
    while (footer && !(footer.props.style && StyleSheet.flatten(footer.props.style).borderTopWidth)) {
      footer = footer.parent;
    }
    expect(StyleSheet.flatten(footer.props.style).paddingBottom).toBe(16 + 34);
  });
});
