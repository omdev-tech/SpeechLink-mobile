import React, { useContext, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../../contexts/AuthContext';
import { ThemeContext } from '../../contexts/ThemeContext';

/**
 * "Log out of all devices": ends every session of the account (this one included) after a
 * confirmation. On success AuthContext drops the token, so the navigator shows the login screen.
 */
const LogoutEverywhereButton: React.FC = () => {
  const { t } = useTranslation();
  const { theme } = useContext(ThemeContext);
  const { signOutEverywhere } = useContext(AuthContext);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await signOutEverywhere();
    } catch (error) {
      console.error('[Settings] log out everywhere failed:', error instanceof Error ? error.message : 'error');
      Alert.alert(t('general.error.title'), t('settings.logoutEverywhereError'));
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    Alert.alert(t('settings.logoutEverywhere'), t('settings.logoutEverywhereConfirm'), [
      { text: t('general.cancel'), style: 'cancel' },
      { text: t('settings.logoutEverywhere'), style: 'destructive', onPress: run },
    ]);
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
        <Ionicons name="phone-portrait-outline" size={20} color={theme.error} />
      )}
      <Text style={[styles.text, { color: theme.error }]}>{t('settings.logoutEverywhere')}</Text>
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

export default LogoutEverywhereButton;
