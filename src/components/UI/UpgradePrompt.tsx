import React, { useContext } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking, Alert } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { ThemeContext, themes } from '../../contexts/ThemeContext';
import { useTranslation } from 'react-i18next';
import { canShowPurchaseOptions } from '../../config/purchases';

interface UpgradePromptProps {
  title?: string;
  message?: string;
  ctaText?: string;
  style?: any;
  size?: 'small' | 'medium' | 'large';
  variant?: 'card' | 'banner' | 'inline';
  onUpgradePress?: () => void;
  targetPlan?: 'INTENSIVE' | 'DAILY_COMPANION';
}

export const UpgradePrompt: React.FC<UpgradePromptProps> = ({
  title,
  message,
  ctaText,
  style,
  size = 'medium',
  variant = 'card',
  onUpgradePress,
  targetPlan = 'INTENSIVE',
}) => {
  const { theme } = useContext(ThemeContext);
  const { t } = useTranslation();
  const styles = makeStyles(theme);
  const isDark = theme === themes.dark;

  const sizeConfig = {
    small: {
      titleFontSize: 15,
      messageFontSize: 13,
      ctaFontSize: 13,
      iconSize: 20,
      padding: 16,
    },
    medium: {
      titleFontSize: 17,
      messageFontSize: 15,
      ctaFontSize: 15,
      iconSize: 24,
      padding: 20,
    },
    large: {
      titleFontSize: 19,
      messageFontSize: 17,
      ctaFontSize: 17,
      iconSize: 28,
      padding: 24,
    },
  };

  const config = sizeConfig[size];

  // iOS: no upgrade wording or button (config/purchases); callers' upgrade copy is not shown.
  const showPurchase = canShowPurchaseOptions();
  const defaultTitle = showPurchase
    ? title || t('upgrade.premiumFeature', 'Premium Access Required')
    : t('upgrade.premiumFeature', 'Premium Access Required');
  const defaultMessage = showPurchase
    ? message || t('upgrade.upgradeMessage', 'This premium voice requires an upgraded plan. Unlock access to all premium voices and enhanced features.')
    : t('purchases.ios.notInPlan', "This feature isn't included in your current plan.");
  const defaultCtaText = ctaText || t('upgrade.upgradeNow', 'View Plans');

  const handleUpgradePress = () => {
    if (onUpgradePress) {
      onUpgradePress();
      return;
    }

    // Default upgrade flow - open web page
    const planParam = targetPlan.toLowerCase().replace('_', '-');
    const url = `https://speech-aac.link/en/profile?upgrade=${planParam}`;
    
    Linking.openURL(url).catch(err => {
      console.error('Failed to open upgrade URL:', err);
      Alert.alert(
        t('general.error.title', 'Error'), 
        t('general.couldNotOpenBrowser', 'Could not open browser')
      );
    });
  };

  const containerStyle = [
    variant === 'card' ? styles.cardContainer : 
    variant === 'banner' ? styles.bannerContainer : 
    styles.inlineContainer,
    { padding: config.padding },
    style,
  ];

  return (
    <View style={containerStyle}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <MaterialIcons 
            name="lock-outline" 
            size={config.iconSize} 
            color="#6B7280"
          />
        </View>
        
        <View style={styles.textContainer}>
          <Text style={[styles.title, { fontSize: config.titleFontSize }]}>
            {defaultTitle}
          </Text>
          <Text style={[styles.message, { fontSize: config.messageFontSize }]}>
            {defaultMessage}
          </Text>
        </View>
      </View>
      
      {showPurchase && (
      <TouchableOpacity style={styles.ctaButton} onPress={handleUpgradePress}>
        <Text style={[styles.ctaText, { fontSize: config.ctaFontSize }]}>
          {defaultCtaText}
        </Text>
        <MaterialIcons 
          name="arrow-forward" 
          size={config.ctaFontSize + 2} 
          color="#374151" 
          style={styles.ctaIcon}
        />
      </TouchableOpacity>
      )}
    </View>
  );
};

const makeStyles = (theme: any) => {
  const isDark = theme === themes.dark;
  
  return StyleSheet.create({
    cardContainer: {
      backgroundColor: '#FFFFFF',
      borderRadius: 16,
      borderWidth: 1,
      borderColor: '#E5E7EB',
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 8,
      elevation: 2,
    },
    bannerContainer: {
      backgroundColor: '#F9FAFB',
      borderLeftWidth: 3,
      borderLeftColor: '#9CA3AF',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: '#E5E7EB',
    },
    inlineContainer: {
      backgroundColor: '#FAFAFA',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: '#D1D5DB',
    },
    content: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: 16,
    },
    iconContainer: {
      marginRight: 14,
      marginTop: 2,
      backgroundColor: '#F3F4F6',
      borderRadius: 12,
      padding: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    textContainer: {
      flex: 1,
      paddingTop: 2,
    },
    title: {
      fontWeight: '600',
      color: '#111827',
      marginBottom: 6,
      lineHeight: 22,
    },
    message: {
      color: '#6B7280',
      lineHeight: 22,
      letterSpacing: 0.2,
    },
    ctaButton: {
      backgroundColor: 'transparent',
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'flex-start',
      borderWidth: 1,
      borderColor: '#9CA3AF',
    },
    ctaText: {
      color: '#6B7280',
      fontWeight: '600',
      letterSpacing: 0.3,
    },
    ctaIcon: {
      marginLeft: 8,
    },
  });
};

export default UpgradePrompt; 