import React, { useContext, useEffect, useState } from 'react';
import { StatusBar, Platform, View, ActivityIndicator } from 'react-native';

// Context
import { AuthContext } from '../contexts/AuthContext';
import { ThemeContext, themes } from '../contexts/ThemeContext';

// Navigators
import MainNavigator from './MainNavigator';
import { AuthNavigator } from './AuthNavigator';

// AI data consent (App Store 5.1.2(i)): the main app only mounts once it is given
import AIConsentScreen from '../screens/AIConsent/AIConsentScreen';
import { aiConsentService } from '../services/aiConsentService';

const RootNavigator: React.FC = () => {
  const { token } = useContext(AuthContext);
  const { theme } = useContext(ThemeContext);
  // null while the stored choice is being read
  const [aiConsent, setAiConsent] = useState<boolean | null>(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    aiConsentService.hasConsented().then((given) => {
      if (active) setAiConsent(given);
    });
    return () => { active = false; };
  }, [token]);

  const renderSignedIn = () => {
    if (aiConsent === null) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', backgroundColor: theme.background }}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      );
    }
    return aiConsent ? <MainNavigator /> : <AIConsentScreen onAccepted={() => setAiConsent(true)} />;
  };

  return (
    <>
      <StatusBar
        barStyle={theme === themes.dark ? 'light-content' : 'dark-content'}
        backgroundColor={Platform.OS === 'android' ? theme.background : undefined}
      />
      {token ? renderSignedIn() : <AuthNavigator />}
    </>
  );
};

export default RootNavigator; 