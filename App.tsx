// Must stay the first import: redacts tokens/codes from every console call that follows.
import './src/utils/installSafeConsole';
import React, { useEffect } from 'react';
import { I18nManager, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { I18nextProvider, useTranslation } from 'react-i18next';

// Providers
import { ThemeProvider } from './src/contexts/ThemeContext';
import { AuthProvider } from './src/contexts/AuthContext';
import { ToastProvider } from './src/components/UI/ToastProvider';
import { TutorialProvider } from './src/contexts/TutorialContext';

// Navigation
import RootNavigator from './src/navigation/RootNavigator';

// i18n
import i18n from './src/i18n';

// Utils
import { isRTL } from './src/utils/rtlLanguages';

// RTL support wrapper component
const RTLWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { i18n } = useTranslation();
  
  useEffect(() => {
    const currentLang = i18n.language;
    const shouldBeRTL = isRTL(currentLang);
    
    if (I18nManager.isRTL !== shouldBeRTL) {
      I18nManager.allowRTL(shouldBeRTL);
      I18nManager.forceRTL(shouldBeRTL);
      // In a production app, you might want to reload here
      // This would require a native module for a complete reload
    }
  }, [i18n.language]);
  
  return <>{children}</>;
};

export default function App() {
  return (
    <I18nextProvider i18n={i18n}>
      <SafeAreaProvider>
        <StatusBar style="auto" translucent backgroundColor="transparent" />
        <ThemeProvider>
          <AuthProvider>
            <TutorialProvider>
              <ToastProvider>
                <NavigationContainer>
                  <RTLWrapper>
                    <RootNavigator />
                  </RTLWrapper>
                </NavigationContainer>
              </ToastProvider>
            </TutorialProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </I18nextProvider>
  );
} 