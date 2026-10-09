import React, { useContext } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ThemeContext, themes } from '../../contexts/ThemeContext';
import { canShowPurchaseOptions } from '../../config/purchases';

interface CreditLimitModalProps {
  visible: boolean;
  onClose: () => void;
  onUpgrade?: () => void;
}

export const CreditLimitModal: React.FC<CreditLimitModalProps> = ({
  visible,
  onClose,
  onUpgrade,
}) => {
  const { theme } = useContext(ThemeContext);
  const { t, i18n } = useTranslation();
  const isDark = theme === themes.dark;
  const styles = makeStyles(isDark);
  // iOS: no subscribe message or upgrade button (config/purchases).
  const showPurchase = canShowPurchaseOptions();

  const handleUpgrade = () => {
    if (onUpgrade) {
      onUpgrade();
      return;
    }

    // Default: open the upgrade page in browser
    const lang = i18n.language || 'en';
    const url = `https://speech-aac.link/${lang}/profile?upgrade=true`;
    
    Linking.openURL(url).catch(err => {
      console.error('Failed to open upgrade URL:', err);
      Alert.alert(
        t('general.error.title', 'Error'),
        t('general.couldNotOpenBrowser', 'Could not open browser')
      );
    });
    
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Icon */}
          <View style={styles.iconContainer}>
            <Ionicons 
              name="battery-dead-outline" 
              size={48} 
              color={isDark ? '#F59E0B' : '#D97706'} 
            />
          </View>

          {/* Title */}
          <Text style={styles.title}>
            {t('subscription.noCreditsTitle', 'Credits Exhausted')}
          </Text>

          {/* Main message */}
          <Text style={styles.message}>
            {t('subscription.noCreditsMessage', "You've used all your credits for this month.")}
          </Text>

          {/* Indie developer message */}
          {showPurchase && (
          <View style={styles.indieDevContainer}>
            <Ionicons 
              name="heart" 
              size={20} 
              color="#EC4899" 
              style={styles.heartIcon}
            />
            <Text style={styles.indieDevMessage}>
              {t('subscription.indieDevMessage', 'SpeechLink is made by indie developers. Subscribing helps us keep improving the app and adding new features for people who need it.')}
            </Text>
          </View>
          )}

          {/* Buttons */}
          <View style={styles.buttonContainer}>
            {showPurchase && (
            <TouchableOpacity
              style={styles.upgradeButton}
              onPress={handleUpgrade}
              activeOpacity={0.8}
            >
              <Ionicons name="rocket-outline" size={20} color="#FFFFFF" />
              <Text style={styles.upgradeButtonText}>
                {t('subscription.upgrade', 'Upgrade Plan')}
              </Text>
            </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.laterButton}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <Text style={styles.laterButtonText}>
                {showPurchase ? t('subscription.later', 'Maybe Later') : t('general.ok', 'OK')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const makeStyles = (isDark: boolean) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
    },
    container: {
      backgroundColor: isDark ? '#1F2937' : '#FFFFFF',
      borderRadius: 20,
      padding: 24,
      width: '100%',
      maxWidth: 340,
      alignItems: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 16,
      elevation: 8,
    },
    iconContainer: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: isDark ? '#374151' : '#FEF3C7',
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 16,
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: isDark ? '#F9FAFB' : '#111827',
      marginBottom: 8,
      textAlign: 'center',
    },
    message: {
      fontSize: 16,
      color: isDark ? '#D1D5DB' : '#4B5563',
      textAlign: 'center',
      lineHeight: 24,
      marginBottom: 16,
    },
    indieDevContainer: {
      flexDirection: 'row',
      backgroundColor: isDark ? '#374151' : '#FDF2F8',
      borderRadius: 12,
      padding: 16,
      marginBottom: 24,
      alignItems: 'flex-start',
    },
    heartIcon: {
      marginRight: 12,
      marginTop: 2,
    },
    indieDevMessage: {
      flex: 1,
      fontSize: 14,
      color: isDark ? '#F9A8D4' : '#9D174D',
      lineHeight: 22,
    },
    buttonContainer: {
      width: '100%',
      gap: 12,
    },
    upgradeButton: {
      flexDirection: 'row',
      backgroundColor: '#4F46E5',
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 24,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    upgradeButtonText: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '600',
    },
    laterButton: {
      paddingVertical: 12,
      alignItems: 'center',
    },
    laterButtonText: {
      color: isDark ? '#9CA3AF' : '#6B7280',
      fontSize: 15,
      fontWeight: '500',
    },
  });

export default CreditLimitModal;
