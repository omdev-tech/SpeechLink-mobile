import React, { useContext, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../../contexts/AuthContext';
import { ThemeContext } from '../../contexts/ThemeContext';
import { aiConsentService } from '../../services/aiConsentService';

interface Props {
  onAccepted: () => void;
}

/**
 * Shown after login until the user agrees that their voice and text go to third-party AI providers
 * (App Store guideline 5.1.2(i)). Nothing is sent before that: every AI call needs a session, and
 * the main app is not mounted until consent is given. Declining signs the user out.
 */
const AIConsentScreen: React.FC<Props> = ({ onAccepted }) => {
  const { t, i18n } = useTranslation();
  const { theme } = useContext(ThemeContext);
  const { signOut } = useContext(AuthContext);
  const [saving, setSaving] = useState(false);
  const styles = makeStyles(theme);

  const uses = [
    {
      icon: 'mic-outline' as const,
      title: t('aiConsent.speechTitle', 'Speech recognition'),
      text: t('aiConsent.speechText', 'Your voice recordings are sent to ElevenLabs (backups: Deepgram, OpenAI, Speechmatics) to turn them into text.'),
    },
    {
      icon: 'create-outline' as const,
      title: t('aiConsent.correctionTitle', 'Text correction'),
      text: t('aiConsent.correctionText', 'The transcribed text is sent to Mistral AI (backup: OpenAI) to turn it into clear sentences.'),
    },
    {
      icon: 'volume-high-outline' as const,
      title: t('aiConsent.voiceTitle', 'Voice generation'),
      text: t('aiConsent.voiceText', 'The text to speak is sent to ElevenLabs (backup: OpenAI) to read it aloud.'),
    },
  ];

  const accept = async () => {
    setSaving(true);
    try {
      await aiConsentService.giveConsent();
      onAccepted();
    } catch (error) {
      console.error('[AIConsent] saving consent failed:', error);
      Alert.alert(t('general.error.title', 'Error'), t('aiConsent.saveError', 'Your choice could not be saved. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const decline = () => {
    Alert.alert(
      t('aiConsent.declineTitle', 'Continue without agreeing?'),
      t('aiConsent.declineMessage', 'Speech Link cannot transcribe, correct or speak your sentences without these services. You will be signed out; sign in again whenever you want to agree.'),
      [
        { text: t('general.cancel', 'Cancel'), style: 'cancel' },
        { text: t('auth.signOut', 'Sign Out'), style: 'destructive', onPress: () => { signOut(); } },
      ]
    );
  };

  const openPrivacyPolicy = () => {
    Linking.openURL(`https://speech-aac.link/${i18n.language}/privacy`).catch((error) =>
      console.error('[AIConsent] opening privacy policy failed:', error)
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Ionicons name="shield-checkmark-outline" size={48} color={theme.primary} style={styles.headerIcon} />
        <Text style={styles.title} accessibilityRole="header">
          {t('aiConsent.title', 'Your data and AI')}
        </Text>
        <Text style={styles.intro}>
          {t('aiConsent.intro', 'Speech Link uses AI services from other companies to work. When you use a feature, the data it needs is sent to these providers, who process it on our behalf:')}
        </Text>

        {uses.map((use) => (
          <View key={use.title} style={styles.useRow}>
            <Ionicons name={use.icon} size={24} color={theme.primary} style={styles.useIcon} />
            <View style={styles.useBody}>
              <Text style={styles.useTitle}>{use.title}</Text>
              <Text style={styles.useText}>{use.text}</Text>
            </View>
          </View>
        ))}

        <Text style={styles.note}>
          {t('aiConsent.note', 'Nothing is sent until you agree. You can stop at any time by deleting your account in Settings.')}
        </Text>
        <TouchableOpacity onPress={openPrivacyPolicy} accessibilityRole="link">
          <Text style={styles.link}>{t('aiConsent.privacyLink', 'Read our privacy policy')}</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.acceptButton} onPress={accept} disabled={saving} accessibilityRole="button">
          {saving ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.acceptText}>{t('aiConsent.accept', 'I agree')}</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.declineButton} onPress={decline} disabled={saving} accessibilityRole="button">
          <Text style={styles.declineText}>{t('aiConsent.decline', 'I do not agree')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const makeStyles = (theme: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  content: {
    padding: 24,
  },
  headerIcon: {
    alignSelf: 'center',
    marginTop: 16,
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.text,
    textAlign: 'center',
    marginBottom: 16,
  },
  intro: {
    fontSize: 16,
    lineHeight: 22,
    color: theme.text,
    marginBottom: 20,
  },
  useRow: {
    flexDirection: 'row',
    backgroundColor: theme.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  useIcon: {
    marginRight: 12,
    marginTop: 2,
  },
  useBody: {
    flex: 1,
  },
  useTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.text,
    marginBottom: 4,
  },
  useText: {
    fontSize: 14,
    lineHeight: 20,
    color: theme.textLight,
  },
  note: {
    fontSize: 14,
    lineHeight: 20,
    color: theme.textLight,
    marginTop: 8,
    marginBottom: 12,
  },
  link: {
    fontSize: 15,
    color: theme.primary,
    textDecorationLine: 'underline',
  },
  actions: {
    padding: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  acceptButton: {
    backgroundColor: theme.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 10,
  },
  acceptText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  declineButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  declineText: {
    color: theme.textLight,
    fontSize: 15,
  },
});

export default AIConsentScreen;
