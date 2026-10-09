import React, { useContext, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../../contexts/AuthContext';
import { ThemeContext } from '../../contexts/ThemeContext';

/**
 * "Delete account" (App Store 5.1.1(v), Google Play account deletion policy): deletes the account
 * and its data after a confirmation. Accounts that sign in with Apple are re-confirmed with Apple
 * (AuthContext.deleteAccount). On success AuthContext drops the token, so the navigator shows the
 * login screen.
 */
const DeleteAccountButton: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { theme } = useContext(ThemeContext);
  const { deleteAccount } = useContext(AuthContext);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const outcome = await deleteAccount(i18n.language);
      if (outcome.status === 'deleted') {
        Alert.alert(t('account.delete.doneTitle', 'Account deleted'), t('account.delete.doneMessage', 'Your account and its data have been deleted.'));
      } else if (outcome.status === 'failed') {
        console.error('[Settings] delete account failed:', outcome.code);
        const message = outcome.code === 'SUBSCRIPTION_CANCEL_FAILED'
          ? t('account.delete.subscriptionError', 'Your subscription could not be cancelled, so your account was not deleted. Please try again later.')
          : t('account.delete.error', 'Your account could not be deleted. Please try again later.');
        Alert.alert(t('general.error.title', 'Error'), message);
      }
    } catch (error) {
      console.error('[Settings] delete account failed:', error instanceof Error ? error.message : 'error');
      Alert.alert(t('general.error.title', 'Error'), t('account.delete.error', 'Your account could not be deleted. Please try again later.'));
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    Alert.alert(
      t('account.delete.confirmTitle', 'Delete your account?'),
      t('account.delete.confirmMessage', 'This permanently deletes your account and your data: saved sentences, voice settings, dictionary, Discord connection and voice clones. Any active subscription is cancelled. This cannot be undone.'),
      [
        { text: t('general.cancel', 'Cancel'), style: 'cancel' },
        { text: t('account.delete.confirm', 'Delete'), style: 'destructive', onPress: run },
      ]
    );
  };

  return (
    <TouchableOpacity
      style={[styles.button, { borderColor: theme.error }]}
      onPress={confirm}
      disabled={busy}
      accessibilityRole="button"
    >
      {busy ? (
        <ActivityIndicator size="small" color={theme.error} />
      ) : (
        <Ionicons name="trash-outline" size={20} color={theme.error} />
      )}
      <Text style={[styles.text, { color: theme.error }]}>{t('account.delete.button', 'Delete account')}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginHorizontal: 20,
    marginTop: -10,
    marginBottom: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  text: {
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },
});

export default DeleteAccountButton;
