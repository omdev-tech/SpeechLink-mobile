import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  FlatList,
  Linking
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';
import { useFocusEffect } from '@react-navigation/native';
import axios from 'axios';

// Replace hardcoded URL with environment-aware URL
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://speech-aac.link';

// Context
import { useDiscord } from '../../contexts/DiscordContext';
import { ThemeContext, themes } from '../../contexts/ThemeContext';
import { useContext } from 'react';
import { AuthContext } from '../../contexts/AuthContext';

// Types from service
import { DiscordServer, DiscordChannel } from '../../services/discordService';
import {
  DISCORD_OAUTH_REDIRECT_URL,
  isDiscordCallbackError,
  parseDiscordCallbackUrl,
} from '../../services/discordOAuthRedirect';
import { claimCallbackUrl, clearHandledCallbackUrls } from '../../services/discordCallbackLinks';

const DiscordSettingsScreen: React.FC = () => {
  // Move all hooks to the top level of the component function
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { theme } = useContext(ThemeContext);
  const isDarkMode = theme === themes.dark;
  
  // Use AuthContext to get the token
  const { token: authToken } = useContext(AuthContext);
  
  // Use the Discord context
  const {
    isLoading,
    isAuthenticated,
    isConnected,
    connectionStatus,
    servers,
    channels,
    currentServer,
    currentChannel,
    error,
    getDiscordAuthUrl,
    handleDiscordCallback,
    loadServers,
    loadChannels,
    loadSettings,
    selectServer,
    selectChannel,
    saveSettings,
    connect,
    disconnect
  } = useDiscord();

  // Add console logging to debug context values when they change
  useEffect(() => {
    console.log("Discord context values changed:", { 
      isAuthenticated, 
      isConnected,
      currentServerId: currentServer?.id,
      currentServerName: currentServer?.name,
      currentChannelId: currentChannel?.id,
      currentChannelName: currentChannel?.name,
      serversCount: servers.length,
      channelsCount: channels.length
    });
  }, [isAuthenticated, isConnected, currentServer, currentChannel, servers, channels]);
  
  // State hooks
  const [serverModalVisible, setServerModalVisible] = useState(false);
  const [channelModalVisible, setChannelModalVisible] = useState(false);
  const [authInProgress, setAuthInProgress] = useState(false);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  
  // Create refs outside of useEffect
  const wasConnectedRef = useRef(false);
  // True while openAuthSessionAsync owns the OAuth round-trip; the global deep-link
  // listener then only records the discord-callback URL (see pendingRedirectRef).
  const authSessionActiveRef = useRef(false);
  // Redirect delivered through Linking during the auth session. On Android the session
  // can resolve 'dismiss' although the redirect did arrive this way.
  const pendingRedirectRef = useRef<string | null>(null);
  const styles = makeStyles(theme, isDarkMode);

  // Create stable versions of Discord context functions
  const stableLoadSettings = useCallback(() => {
    console.log("Calling loadSettings...");
    return loadSettings();
  }, [loadSettings]);
  
  const stableConnect = useCallback(() => {
    console.log("Calling connect...");
    return connect();
  }, [connect]);
  
  const stableDisconnect = useCallback(() => {
    console.log("Calling disconnect...");
    return disconnect();
  }, [disconnect]);
  
  const stableSaveSettings = useCallback(() => {
    console.log("Calling stableSaveSettings which calls saveSettings...");
    return saveSettings();
  }, [saveSettings]);
  
  // Load settings once when the screen is focused
  // REMOVING THIS useFocusEffect BLOCK
  
  // Deep link back from the OAuth callback page when it arrives outside an auth session
  // (e.g. the app was restarted while the browser was open).
  const handleDeepLink = useCallback(async (event: { url: string }) => {
    const url = event.url;
    if (!url.includes('discord-callback')) {
      return;
    }
    if (authSessionActiveRef.current) {
      pendingRedirectRef.current = url;
      return;
    }
    if (!claimCallbackUrl(url)) {
      return;
    }
    setAuthInProgress(false);
    const params = parseDiscordCallbackUrl(url);
    if (isDiscordCallbackError(params)) {
      Alert.alert(t('discord.authFailed'), t('discord.authFailedMessage'));
      return;
    }
    if (!params.code && !params.tempKey && params.status !== 'success') {
      return;
    }
    try {
      const success = await handleDiscordCallback(params.code ?? '', {
        tempKey: params.tempKey,
        linked: params.linked,
      });
      if (success) {
        Alert.alert(
          t('discord.authSuccess'),
          t('discord.authSuccessMessage')
        );
        // Reload settings after successful authentication
        await stableLoadSettings();
      } else {
        Alert.alert(
          t('discord.authFailed'),
          t('discord.authFailedMessage')
        );
      }
    } catch (err) {
      console.error('Error handling Discord callback:', err);
      Alert.alert(
        t('discord.authFailed'),
        t('discord.authFailedMessage')
      );
    }
  }, [handleDiscordCallback, stableLoadSettings, t]);

  // Always call the latest handler without re-subscribing when its identity changes.
  const handleDeepLinkRef = useRef(handleDeepLink);
  handleDeepLinkRef.current = handleDeepLink;

  // Runtime deep links for the Discord OAuth callback: subscribe once. The cold-start launch
  // URL is claimed app-wide by DiscordProvider, not here.
  useEffect(() => {
    const subscription = Linking.addEventListener('url', (event) => {
      handleDeepLinkRef.current(event);
    });

    return () => {
      subscription.remove();
    };
  }, []);

  // Start Discord OAuth. Deliberately independent of `isAuthenticated`: it is also used to
  // re-authenticate an already linked account ("Refresh connection"), whose tokens the
  // server may have lost. The backend's OAuth callback overwrites the stored tokens (and
  // keeps the selected server/channel), so no unlink is needed first.
  const startDiscordOAuth = useCallback(async ({ reauth }: { reauth: boolean }) => {
    setAuthInProgress(true);
    try {
      // Get auth URL from backend
      const authUrl = await getDiscordAuthUrl();
      if (!authUrl) {
        throw new Error('Failed to get Discord authorization URL');
      }

      console.log('Opening Discord auth session:', authUrl);
      clearHandledCallbackUrls();
      pendingRedirectRef.current = null;
      authSessionActiveRef.current = true;
      // Closes the in-app browser by itself when the callback page redirects to
      // DISCORD_OAUTH_REDIRECT_URL (see discordOAuthRedirect.ts for the contract).
      const result = await WebBrowser.openAuthSessionAsync(authUrl, DISCORD_OAUTH_REDIRECT_URL);
      console.log('Discord auth session result:', result.type);

      // On Android the session may resolve 'dismiss' although the redirect arrived via Linking.
      const redirectUrl = result.type === 'success' ? result.url : pendingRedirectRef.current;
      authSessionActiveRef.current = false;
      pendingRedirectRef.current = null;

      let success: boolean;
      if (redirectUrl) {
        claimCallbackUrl(redirectUrl); // a late duplicate delivery is then ignored
        const params = parseDiscordCallbackUrl(redirectUrl);
        if (isDiscordCallbackError(params)) {
          success = false;
        } else {
          // Claim exactly what the backend handed back. linked=1 is a confirmed fresh link;
          // otherwise, on re-auth an existing link is not proof that the new code was
          // exchanged (requireFreshAuth).
          success = await handleDiscordCallback(params.code ?? '', {
            tempKey: params.tempKey,
            linked: params.linked,
            requireFreshAuth: reauth,
          });
        }
      } else {
        // cancel / dismiss without redirect: the user closed the browser. An older callback
        // page may still have linked the account through a web session: one check-auth
        // (first connect only; on re-auth nothing here can prove fresh tokens).
        success = reauth ? false : await handleDiscordCallback('', { requireFreshAuth: false });
        if (!success) {
          console.log('Discord auth session closed without completing OAuth');
          return false;
        }
      }

      if (success) {
        Alert.alert(
          t('discord.authSuccess'),
          t('discord.authSuccessMessage')
        );
      } else {
        Alert.alert(
          t('discord.authFailed'),
          reauth ? t('discord.refreshFailed') : t('discord.authFailedMessage')
        );
      }
      return success;
    } catch (err) {
      console.error('Error during Discord authentication:', err);
      Alert.alert(
        t('general.error.title'),
        t('discord.authError', 'Failed to connect to Discord. Please try again.')
      );
      return false;
    } finally {
      authSessionActiveRef.current = false;
      setAuthInProgress(false);
    }
  }, [getDiscordAuthUrl, handleDiscordCallback, t]);

  // Connect Discord Account
  const handleConnectToDiscord = useCallback(async () => {
    if (isAuthenticated) {
      // If already authenticated, just load settings
      await stableLoadSettings();
      return;
    }
    await startDiscordOAuth({ reauth: false });
  }, [isAuthenticated, stableLoadSettings, startDiscordOAuth]);

  // Re-run Discord OAuth for an already linked account (e.g. tokens lost server-side).
  const handleRefreshConnection = useCallback(() => {
    Alert.alert(
      t('discord.refreshConfirmTitle'),
      t('discord.refreshConfirmMessage'),
      [
        { text: t('general.cancel'), style: 'cancel' },
        {
          text: t('discord.refreshConfirmAction'),
          style: 'destructive',
          onPress: async () => {
            const success = await startDiscordOAuth({ reauth: true });
            if (!success) {
              // Resync the screen with the server whatever happened in the browser.
              await stableLoadSettings().catch((err) =>
                console.error('Error reloading Discord settings after refresh:', err)
              );
            }
          },
        },
      ]
    );
  }, [startDiscordOAuth, stableLoadSettings, t]);

  // Invite Discord Bot
  const handleInviteBot = useCallback(async () => {
    try {
      const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID || '1372876918713483326'}&permissions=36700160&scope=bot`;
      if (Platform.OS === 'web') {
        window.open(inviteUrl, '_blank');
      } else {
        await Linking.openURL(inviteUrl);
      }
    } catch (err) {
      Alert.alert(t('general.error.title'), t('discord.inviteUrlError', 'Failed to open invite URL'));
    }
  }, []);

  // Direct API call function to save Discord settings
  const directSaveSettings = async (specificChannelId?: string) => {
    console.log('Directly saving Discord settings via API...');
    
    if (!currentServer) {
      console.error('No server selected, cannot save settings');
      return false;
    }
    
    try {
      // Use specific channel ID if provided, otherwise use current channel
      const channelId = specificChannelId !== undefined ? specificChannelId : currentChannel?.id || null;
      const channelName = currentChannel?.name || null;
      
      // Log what we're about to send
      console.log('Sending settings to API:', {
        selectedServerId: currentServer.id,
        selectedServerName: currentServer.name,
        selectedChannelId: channelId,
        selectedChannelName: channelName
      });
      
      // Make the API call directly with correct parameter names
      const response = await axios.post(
        `${API_BASE_URL}/api/discord/settings`,
        {
          selectedServerId: currentServer.id,
          selectedServerName: currentServer.name,
          selectedChannelId: channelId,
          selectedChannelName: channelName
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          }
        }
      );
      
      console.log('Direct API call response:', response.data);
      
      // Verify the response
      if (response.status === 200 && response.data.success) {
        console.log('Settings successfully saved via direct API call');
        return true;
      } else {
        console.error('Failed to save settings via direct API:', response.data);
        return false;
      }
    } catch (err) {
      console.error('Error making direct API call to save settings:', err);
      return false;
    }
  };

  // Simplify server selection with a cleaner flow
  const handleServerSelection = useCallback(async (server: DiscordServer) => {
    console.log(`User selected server: ${server.id} (${server.name})`);
    
    // Step 1: Update UI state first
    selectServer(server);
    selectChannel(null as any); // Clear channel selection
    setServerModalVisible(false);
    
    // Step 2: Load channels for this server
    try {
      await loadChannels(server.id);
      console.log(`Loaded channels for server ${server.id}`);
    } catch (err) {
      console.error(`Failed to load channels for server ${server.id}:`, err);
    }
    
    // Step 3: Save server selection (without channel)
    try {
      console.log('Saving server selection (without channel)...');
      
      // Don't use state which might not be updated yet - use the server directly
      console.log('Directly saving Discord settings via API...');
      
      try {
        // Make the API call directly with the selected server
        const response = await axios.post(
          `${API_BASE_URL}/api/discord/settings`,
          {
            selectedServerId: server.id,
            selectedServerName: server.name,
            selectedChannelId: null,
            selectedChannelName: null
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}`
            }
          }
        );
        
        console.log('Direct API call response:', response.data);
        
        // Verify the response
        if (response.status === 200 && response.data.success) {
          console.log('Settings successfully saved via direct API call');
          console.log(`Server saved: success`);
        } else {
          console.error('Failed to save settings via direct API:', response.data);
          console.log(`Server saved: failed`);
        }
      } catch (err) {
        console.error('Error making direct API call to save settings:', err);
        console.log(`Server saved: failed`);
      }
    } catch (err) {
      console.error('Error saving server selection:', err);
      console.log(`Server saved: failed`);
    }
  }, [selectServer, selectChannel, loadChannels, authToken]);

  // Update the handleChannelSelection function
  const handleChannelSelection = useCallback(async (channel: DiscordChannel) => {
    console.log(`User selected channel: ${channel.id} (${channel.name})`);
    
    // Step 1: Update UI state first
    selectChannel(channel);
    setChannelModalVisible(false);
    
    // Step 2: Save server + channel selection with explicit channel ID
    try {
      console.log('Saving server and channel selection...');
      
      if (!currentServer) {
        console.error('No server selected, cannot save channel settings');
        Alert.alert(
          t('general.error.title'),
          t('discord.selectServerFirst', 'Please select a server first')
        );
        return;
      }
      
      // Make direct API call with explicit IDs using the correct parameter names
      const response = await axios.post(
        `${API_BASE_URL}/api/discord/settings`,
        {
          selectedServerId: currentServer.id,
          selectedServerName: currentServer.name,
          selectedChannelId: channel.id,
          selectedChannelName: channel.name,
          save: true
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          }
        }
      );
      
      console.log('Direct API call response:', response.data);
      
      if (response.status === 200 && response.data.success) {
        console.log('Settings saved successfully');
        
        // Just verify the API call was successful without checking specific fields
        // The GET settings endpoint returns different data than we expected
        try {
          const verifyResponse = await axios.get(
            `${API_BASE_URL}/api/discord/settings`,
            {
              headers: {
                'Authorization': `Bearer ${authToken}`
              }
            }
          );
          
          console.log('Verify settings response:', verifyResponse.data);
          // Just check that we get a successful response, don't validate fields
          // since the response format is different than expected
          if (verifyResponse.status === 200) {
            console.log('Settings verified: API endpoint accessible');
          }
          
          // Try to connect immediately after successfully saving settings
          // This might work better since it's a direct action after selection
          console.log('Trying to connect immediately after channel selection...');
          
          // Simple connect call without parameters
          const connectSuccess = await stableConnect();
          
          if (connectSuccess) {
            console.log('Successfully connected to Discord after channel selection (reported by context connect)');
          } else {
            console.log('Could not connect immediately after selection (reported by context connect)');
          }
          
        } catch (err) {
          console.error('Error verifying settings or connecting:', err);
        }
      } else {
        console.error('Failed to save settings');
        Alert.alert(
          t('general.error.title'),
          t('discord.failedToSaveSettings', 'Failed to save Discord settings. Please try again.')
        );
      }
    } catch (err) {
      console.error('Error saving settings:', err);
      Alert.alert(
        t('general.error.title'),
        t('discord.failedToSaveSettings', 'Failed to save Discord settings. Please try again.')
      );
    }
  }, [selectChannel, currentServer, authToken, stableConnect]);

  // Use handleServerSelection instead of handleSelectServer
  const handleSelectServer = handleServerSelection;
  
  // Use handleChannelSelection instead of handleSelectChannel
  const handleSelectChannel = handleChannelSelection;

  // Join or Disconnect Voice Channel
  const handleJoinOrDisconnect = useCallback(async () => {
    try {
      if (isConnected) {
        // If connected, just disconnect
        console.log('Attempting to disconnect from Discord voice channel...');
        const success = await disconnect(); // Use direct context function
        
        if (success) {
          console.log('Successfully disconnected from Discord voice channel');
        } else {
          console.error('Failed to disconnect from Discord voice channel');
          Alert.alert(
            t('general.error.title'),
            t('discord.disconnectFailed', 'Failed to disconnect from Discord voice channel')
          );
        }
      } else {
        // Check if server and channel are selected
        if (!currentServer || !currentChannel) {
          console.error(`Missing server or channel: Server=${currentServer?.id}, Channel=${currentChannel?.id}`);
          Alert.alert(
            t('general.error.title'),
            t('discord.selectServerAndChannel', 'Please select a server and channel first')
          );
          return;
        }

        // Log the current server and channel
        console.log(`Attempting to join voice - Server: ${currentServer.id} (${currentServer.name}), Channel: ${currentChannel.id} (${currentChannel.name})`);

        // First ensure settings are saved with correct parameter names
        console.log('Ensuring settings are saved before connecting...');
        try {
          // Make direct API call to save settings
          const response = await axios.post(
            `${API_BASE_URL}/api/discord/settings`,
            {
              selectedServerId: currentServer.id,
              selectedServerName: currentServer.name,
              selectedChannelId: currentChannel.id,
              selectedChannelName: currentChannel.name
            },
            {
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
              }
            }
          );
          
          console.log('Settings API response:', response.data);
          
          if (!(response.status === 200 && response.data.success)) {
            console.error('Failed to save settings before connecting');
            Alert.alert(
              t('general.error.title'),
              t('discord.failedToSaveSettings', 'Failed to save Discord settings before connecting')
            );
            return;
          }
          
          // Verify the settings were saved by checking the current settings
          try {
            console.log('Verifying settings were saved...');
            const settingsResponse = await axios.get(
              `${API_BASE_URL}/api/discord/settings`,
              {
                headers: {
                  'Authorization': `Bearer ${authToken}`
                }
              }
            );
            console.log('Current server settings:', settingsResponse.data);
          } catch (err) {
            console.error('Error checking settings:', err);
          }
          
          console.log('Settings saved successfully, proceeding with connection');
        } catch (err) {
          console.error('Error ensuring settings are saved:', err);
          Alert.alert(
            t('general.error.title'),
            t('discord.failedToSaveSettings', 'Failed to save Discord settings before connecting')
          );
          return;
        }
        
        // Now connect using the direct connect helper
        // const connectSuccess = await directConnectWithSettings();
        // Use the context's connect function which should update the 'isConnected' state
        console.log("Attempting to connect using context's connect function...");
        const connectSuccess = await stableConnect();
        
        if (connectSuccess) {
          console.log('Successfully connected to Discord voice channel (reported by context connect)');
          // UI should update based on 'isConnected' from context changing.
          // No explicit Alert.alert for success here, let the UI reflect the change.
        } else {
          console.error('Failed to connect to Discord voice channel (reported by context connect)');
          Alert.alert(
            t('general.error.title'),
            t('discord.connectionError', 'An error occurred while managing the Discord connection')
          );
        }
      }
    } catch (err) {
      console.error('Error joining/disconnecting voice channel:', err);
      Alert.alert(
        t('general.error.title'),
        t('discord.connectionError', 'An error occurred while managing the Discord connection')
      );
    }
  }, [currentServer, currentChannel, isConnected, stableConnect, stableDisconnect, authToken, t]);
  
  // Join/Disconnect Button
  const renderJoinButton = useCallback(() => {
    if (!currentServer || !currentChannel) {
      return null;
    }
    
    return (
      <TouchableOpacity
        style={[
          styles.actionButton,
          isConnected ? styles.disconnectButton : styles.joinButton
        ]}
        onPress={handleJoinOrDisconnect}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <>
            <Ionicons
              name={isConnected ? "exit-outline" : "enter-outline"}
              size={20}
              color="#fff"
              style={styles.buttonIcon}
            />
            <Text style={styles.actionButtonText}>
              {isConnected
                ? t('discord.leaveVoice', 'Leave Voice Channel')
                : t('discord.joinVoice', 'Join Voice Channel')}
            </Text>
          </>
        )}
      </TouchableOpacity>
    );
  }, [currentServer, currentChannel, isConnected, isLoading, handleJoinOrDisconnect, styles, t]);

  const renderServerModal = useCallback(() => (
    <Modal
      visible={serverModalVisible}
      transparent={true}
      animationType="slide"
      onRequestClose={() => setServerModalVisible(false)}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>{t('discord.selectServer')}</Text>
          {isLoading ? (
            <ActivityIndicator size="large" color={theme.primary} />
          ) : servers.length > 0 ? (
            <FlatList
              data={servers}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.modalItem,
                    currentServer?.id === item.id && styles.selectedItem
                  ]}
                  onPress={() => handleSelectServer(item)}
                >
                  <Text style={styles.modalItemText}>{item.name}</Text>
                  {currentServer?.id === item.id && (
                    <Ionicons name="checkmark" size={20} color={theme.primary} />
                  )}
                </TouchableOpacity>
              )}
            />
          ) : (
            <View style={styles.emptyListContainer}>
              <Ionicons name="alert-circle-outline" size={24} color={theme.text} />
              <Text style={styles.emptyListText}>
                {error || t('discord.noServersFound', 'No Discord servers found')}
              </Text>
              <Text style={styles.emptyListSubtext}>
                {t('discord.checkDiscordConnection', 'Make sure your Discord account is properly connected')}
              </Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.modalCloseButton}
            onPress={() => setServerModalVisible(false)}
          >
            <Text style={styles.modalCloseButtonText}>{t('general.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  ), [serverModalVisible, isLoading, servers, currentServer, error, handleSelectServer, styles, theme, t]);

  const renderChannelModal = useCallback(() => (
    <Modal
      visible={channelModalVisible}
      transparent={true}
      animationType="slide"
      onRequestClose={() => setChannelModalVisible(false)}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>{t('discord.selectChannel')}</Text>
          {isLoading ? (
            <ActivityIndicator size="large" color={theme.primary} />
          ) : channels.length > 0 ? (
            <FlatList
              data={channels}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.modalItem,
                    currentChannel?.id === item.id && styles.selectedItem
                  ]}
                  onPress={() => handleSelectChannel(item)}
                >
                  <Text style={styles.modalItemText}>{item.name}</Text>
                  {currentChannel?.id === item.id && (
                    <Ionicons name="checkmark" size={20} color={theme.primary} />
                  )}
                </TouchableOpacity>
              )}
            />
          ) : (
            <View style={styles.emptyListContainer}>
              <Ionicons name="alert-circle-outline" size={24} color={theme.text} />
              <Text style={styles.emptyListText}>
                {error || t('discord.noChannelsFound', 'No voice channels found in this server')}
              </Text>
              <Text style={styles.emptyListSubtext}>
                {t('discord.createVoiceChannel', 'Make sure this server has at least one voice channel')}
              </Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.modalCloseButton}
            onPress={() => setChannelModalVisible(false)}
          >
            <Text style={styles.modalCloseButtonText}>{t('general.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  ), [channelModalVisible, isLoading, channels, currentChannel, error, handleSelectChannel, styles, theme, t]);

  const renderSettingItem = useCallback((
    icon: string,
    title: string,
    value?: React.ReactNode,
    onPress?: () => void,
    showArrow: boolean = true
  ) => (
    <TouchableOpacity
      style={styles.settingItem}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.settingIconContainer}>
        <Ionicons name={icon as any} size={24} color={theme.text} />
      </View>
      <View style={styles.settingTextContainer}>
        <Text style={styles.settingTitle}>{title}</Text>
      </View>
      <View style={styles.settingValueContainer}>
        {value}
        {showArrow && onPress && (
          <Ionicons name="chevron-forward" size={20} color={theme.text} />
        )}
      </View>
    </TouchableOpacity>
  ), [styles, theme.text]);
  
  // Standard componentDidMount-style effect - keep this to load initial settings once
  useEffect(() => {
    if (!initialLoadComplete) {
      console.log('Component mounted, loading settings once');
      stableLoadSettings().then(() => {
        setInitialLoadComplete(true);
      }).catch(err => {
        console.error('Error in initial load:', err);
        setInitialLoadComplete(true);
      });
    }
  }, []);

  // Show loading state before initial load complete
  if (!initialLoadComplete) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('discord.discordSettings')}</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={styles.loadingText}>{t('general.loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Render the main UI
  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('discord.discordSettings')}</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('discord.connection')}</Text>
          
          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Stage 1: Connect Discord Account */}
          <TouchableOpacity
            style={[
              styles.accountButton,
              isAuthenticated ? styles.accountConnectedButton : styles.accountDisconnectedButton
            ]}
            onPress={handleConnectToDiscord}
            disabled={isLoading || authInProgress}
          >
            {isLoading || authInProgress ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons
                  name="logo-discord"
                  size={24}
                  color="#fff"
                />
                <Text style={styles.accountButtonText}>
                  {isAuthenticated
                    ? t('discord.accountConnected', 'Discord Account Connected')
                    : t('discord.linkAccount', 'Connect Discord Account')}
                </Text>
              </>
            )}
          </TouchableOpacity>

          {!isAuthenticated ? (
            <View style={styles.notConnectedContainer}>
              <Ionicons name="information-circle-outline" size={24} color={theme.text} />
              <Text style={styles.notConnectedText}>
                {t('discord.notConnectedHelp', 'Connect your Discord account to stream your voice to Discord voice channels')}
              </Text>
            </View>
          ) : (
            <>
              <TouchableOpacity
                style={styles.inviteBotButton}
                onPress={handleInviteBot}
              >
                <Ionicons name="add-circle-outline" size={20} color="#fff" />
                <Text style={styles.inviteBotButtonText}>
                  {t('discord.inviteBot')}
                </Text>
              </TouchableOpacity>

              {/* Stage 2: Server and Channel Selection */}
              <Text style={styles.sectionSubtitle}>{t('discord.configuration')}</Text>
              
              {renderSettingItem(
                'server-outline',
                t('discord.server'),
                <Text style={styles.settingValue}>
                  {currentServer?.name || t('discord.selectServer')}
                </Text>,
                () => {
                  loadServers();
                  setServerModalVisible(true);
                }
              )}
              
              {currentServer && renderSettingItem(
                'chatbubbles-outline',
                t('discord.voiceChannel'),
                <Text style={styles.settingValue}>
                  {currentChannel?.name || t('discord.selectChannel')}
                </Text>,
                () => {
                  if (currentServer) {
                    loadChannels(currentServer.id);
                    setChannelModalVisible(true);
                  } else {
                    Alert.alert(t('general.error.title'), t('discord.selectServerFirst'));
                  }
                }
              )}
              
              {/* Stage 3: Join/Leave Voice Channel */}
              {renderJoinButton()}

              {/* Re-run OAuth for the linked account, e.g. after the server lost its Discord tokens.
                  Not gated on isConnected: with dead tokens the user cannot even join a channel. */}
              <TouchableOpacity
                style={styles.refreshButton}
                onPress={handleRefreshConnection}
                disabled={isLoading || authInProgress}
              >
                {isLoading || authInProgress ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons
                      name="refresh-outline"
                      size={20}
                      color="#fff"
                      style={styles.buttonIcon}
                    />
                    <Text style={styles.refreshButtonText}>
                      {t('discord.refreshConnection')}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Connection Status Section (only shown when connected) */}
        {isConnected && connectionStatus?.connectionDetails && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('discord.connectionStatus')}</Text>
            
            <View style={styles.connectionInfoItem}>
              <Text style={styles.connectionInfoLabel}>{t('discord.connectedTo')}</Text>
              <Text style={styles.connectionInfoValue}>
                {connectionStatus.connectionDetails.serverName} / {connectionStatus.connectionDetails.channelName}
              </Text>
            </View>
            
            <View style={styles.connectionInfoItem}>
              <Text style={styles.connectionInfoLabel}>{t('discord.connectedSince')}</Text>
              <Text style={styles.connectionInfoValue}>
                {new Date(connectionStatus.connectionDetails.connectedAt).toLocaleString()}
              </Text>
            </View>
            
            <View style={styles.connectionInfoItem}>
              <Text style={styles.connectionInfoLabel}>{t('discord.connectionDuration')}</Text>
              <Text style={styles.connectionInfoValue}>
                {Math.floor(connectionStatus.connectionDetails.durationMs / 60000)} {t('discord.minutes')}
              </Text>
            </View>
          </View>
        )}
        
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('discord.about')}</Text>
          <Text style={styles.helpText}>
            {t('discord.helpText', 'Discord integration allows you to stream your synthesized speech directly to Discord voice channels. Connect your account, select a server and channel, and start speaking!')}
          </Text>
          
          <View style={styles.noticeContainer}>
            <Ionicons name="information-circle-outline" size={20} color={theme.text} />
            <Text style={styles.noticeText}>
              {t('discord.autoDisconnectNotice', 'Discord will automatically disconnect when not in use to save resources.')}
            </Text>
          </View>
        </View>
      </ScrollView>

      {renderServerModal()}
      {renderChannelModal()}
    </SafeAreaView>
  );
};

const makeStyles = (theme: any, isDarkMode: boolean) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.text,
  },
  headerRight: {
    width: 40,
  },
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: theme.textLight,
  },
  section: {
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.text,
    marginBottom: 16,
  },
  sectionSubtitle: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.text,
    marginTop: 20,
    marginBottom: 12,
  },
  errorContainer: {
    backgroundColor: isDarkMode ? '#593431' : '#fdecea',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: isDarkMode ? '#ff6b6b' : '#d32f2f',
    fontSize: 14,
  },
  notConnectedContainer: {
    flexDirection: 'row',
    backgroundColor: isDarkMode ? '#383838' : theme.cardBackground,
    borderRadius: 8,
    padding: 12,
    marginVertical: 12,
    alignItems: 'center',
  },
  notConnectedText: {
    marginLeft: 8,
    flex: 1,
    color: theme.text,
    fontSize: 14,
    lineHeight: 20,
  },
  // Account connection button
  accountButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  accountDisconnectedButton: {
    backgroundColor: '#7289DA', // Discord color
  },
  accountConnectedButton: {
    backgroundColor: '#43B581', // Discord green
  },
  accountButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
    marginLeft: 8,
  },
  // Server selection
  inviteBotButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#36393F', // Discord dark
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  inviteBotButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
    marginLeft: 8,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  settingIconContainer: {
    width: 40,
    alignItems: 'center',
  },
  settingTextContainer: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    color: theme.text,
  },
  settingValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingValue: {
    fontSize: 14,
    color: theme.textLight,
    marginRight: 8,
  },
  // Join/Disconnect button
  actionButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  actionButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  joinButton: {
    backgroundColor: '#43B581', // Discord green
  },
  disconnectButton: {
    backgroundColor: '#ff3b30', // Red color for disconnect
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#7289DA',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 12,
  },
  refreshButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
    marginLeft: 8,
  },
  buttonIcon: {
    marginRight: 8,
  },
  // Connection status
  connectionInfoItem: {
    marginBottom: 12,
  },
  connectionInfoLabel: {
    fontSize: 14,
    color: theme.textLight,
    marginBottom: 4,
  },
  connectionInfoValue: {
    fontSize: 16,
    color: theme.text,
    fontWeight: '500',
  },
  helpText: {
    fontSize: 14,
    lineHeight: 20,
    color: theme.textLight,
  },
  // Modals
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    width: '80%',
    maxHeight: '70%',
    backgroundColor: theme.background,
    borderRadius: 12,
    padding: 16,
    elevation: 5,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.text,
    marginBottom: 16,
    textAlign: 'center',
  },
  modalItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  selectedItem: {
    backgroundColor: isDarkMode ? '#2a2a2a' : theme.highlightBackground,
  },
  modalItemText: {
    fontSize: 16,
    color: theme.text,
  },
  modalCloseButton: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  modalCloseButtonText: {
    fontSize: 16,
    color: theme.primary,
    fontWeight: '600',
  },
  noticeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.card,
    borderRadius: 8,
    padding: 12,
    marginTop: 16,
    borderLeftWidth: 4,
    borderLeftColor: theme.primary,
  },
  noticeText: {
    fontSize: 14,
    color: theme.text,
    marginLeft: 8,
    flex: 1,
  },
  emptyListContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    minHeight: 150,
  },
  emptyListText: {
    fontSize: 16,
    fontWeight: '500',
    color: theme.text,
    marginTop: 12,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyListSubtext: {
    fontSize: 14,
    color: theme.text,
    opacity: 0.7,
    textAlign: 'center',
  },
});

export default DiscordSettingsScreen; 