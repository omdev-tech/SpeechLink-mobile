import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import { Alert, AppState, AppStateStatus } from 'react-native';
import { useTranslation } from 'react-i18next';
import { discordService, DiscordServer, DiscordChannel, DiscordSettings, ConnectionStatus, DiscordCallbackOptions, DiscordHandoffResult } from '../services/discordService';
import { discordAuthFailureKeys } from '../services/discordAuthMessages';
import { consumeInitialDiscordCallbackUrl } from '../services/discordCallbackLinks';
import { isDiscordCallbackError, parseDiscordCallbackUrl } from '../services/discordOAuthRedirect';

interface DiscordContextType {
  isConnected: boolean;
  isLoading: boolean;
  isAuthenticated: boolean;
  connectionStatus: ConnectionStatus | null;
  discordSettings: DiscordSettings | null;
  servers: DiscordServer[];
  channels: DiscordChannel[];
  currentServer: DiscordServer | null;
  currentChannel: DiscordChannel | null;
  error: string | null;
  getDiscordAuthUrl: (codeChallenge?: string) => Promise<string>;
  handleDiscordCallback: (code: string, options?: DiscordCallbackOptions) => Promise<boolean>;
  /** PKCE handoff completion; on success marks the account linked and reloads settings. */
  completeDiscordHandoff: (handoff: string, verifier: string) => Promise<DiscordHandoffResult>;
  loadServers: () => Promise<void>;
  loadChannels: (serverId: string) => Promise<void>;
  loadSettings: () => Promise<void>;
  selectServer: (server: DiscordServer) => void;
  selectChannel: (channel: DiscordChannel) => void;
  saveSettings: () => Promise<boolean>;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<boolean>;
  refreshConnectionStatus: () => Promise<void>;
  streamSpeech: (text: string, audioData?: string) => Promise<boolean>;
}

const DiscordContext = createContext<DiscordContextType | undefined>(undefined);

export const DiscordProvider = ({ children }: { children: ReactNode }) => {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null);
  const [discordSettings, setDiscordSettings] = useState<DiscordSettings | null>(null);
  const [servers, setServers] = useState<DiscordServer[]>([]);
  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [currentServer, setCurrentServer] = useState<DiscordServer | null>(null);
  const [currentChannel, setCurrentChannel] = useState<DiscordChannel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastStatusRefreshTime, setLastStatusRefreshTime] = useState<number>(0);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  // Refresh connection status periodically
  useEffect(() => {
    const intervalId = setInterval(() => {
      refreshConnectionStatus();
    }, 5000); // Check every 5 seconds

    return () => clearInterval(intervalId);
  }, []);

  const getDiscordAuthUrl = useCallback(async (codeChallenge?: string): Promise<string> => {
    setIsLoading(true);
    setError(null);
    try {
      const url = await discordService.getAuthUrl(codeChallenge);
      return url;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get Discord auth URL';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadServers = useCallback(async (): Promise<void> => {
    // Double-check authentication status before loading servers
    const authStatus = await discordService.getSettings();
    const isUserAuthenticated = authStatus.connected === true;
    
    if (!isUserAuthenticated) {
      console.log('Not loading servers - user not authenticated with Discord');
      return;
    }
    
    console.log('Loading servers - user is authenticated with Discord');
    setIsLoading(true);
    setError(null);
    try {
      const serverList = await discordService.getServers();
      console.log(`Received ${serverList.length} servers from API`);
      setServers(serverList);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load Discord servers';
      console.error('Error loading Discord servers:', err);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadChannels = useCallback(async (serverId: string): Promise<void> => {
    // Double-check authentication status before loading channels
    const authStatus = await discordService.getSettings();
    const isUserAuthenticated = authStatus.connected === true;
    
    if (!isUserAuthenticated) {
      console.log('Not loading channels - user not authenticated with Discord');
      return;
    }
    
    console.log(`Loading channels for server ${serverId} - user is authenticated with Discord`);
    setIsLoading(true);
    setError(null);
    try {
      const channelList = await discordService.getChannels(serverId);
      console.log(`Received ${channelList.length} channels from API`);
      setChannels(channelList);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load Discord channels';
      console.error('Error loading Discord channels:', err);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshConnectionStatus = useCallback(async (): Promise<void> => {
    // Exit early if not authenticated
    if (!isAuthenticated) {
      // Don't try to refresh status if not authenticated
      return;
    }
    
    // Check if we've refreshed very recently (throttle)
    const now = Date.now();
    const timeSinceLastRefresh = now - lastStatusRefreshTime;
    if (timeSinceLastRefresh < 2000) { // 2 second cooldown
      console.log(`Skipping connection status refresh (throttled: ${timeSinceLastRefresh}ms since last refresh)`);
      return;
    }
    
    setLastStatusRefreshTime(now);
    
    try {
      console.log('Refreshing Discord connection status...');
      const status = await discordService.getConnectionStatus();
      
      // Only update state if connection status actually changed
      if (JSON.stringify(status) !== JSON.stringify(connectionStatus)) {
        console.log('Connection status changed, updating state:', status);
        setConnectionStatus(status);
        setIsConnected(status.isConnected);
      } else {
        console.log('Connection status unchanged, skipping state update');
      }
    } catch (err) {
      console.error('Failed to refresh Discord connection status:', err);
      // Don't set error state here to avoid constant errors in UI during polling
      
      // If we get a 401, the user is no longer authenticated
      if (err instanceof Error && err.message.includes('401')) {
        setIsAuthenticated(false);
        setIsConnected(false);
        setConnectionStatus(null);
      }
    }
  }, [isAuthenticated, lastStatusRefreshTime, connectionStatus]);

  const loadSettings = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      // Try to load settings
      let settings: DiscordSettings;
      try {
        settings = await discordService.getSettings();
        console.log('Discord settings loaded successfully:', settings);
      } catch (err) {
        // Check if it's a 401 error
        if (err instanceof Error && err.message.includes('401')) {
          console.log('User not authenticated with Discord, returning default settings');
          // Return default settings for an unauthenticated user
          settings = {
            connected: false,
            isConnected: false
          };
        } else {
          // Rethrow other errors
          throw err;
        }
      }
      
      setDiscordSettings(settings);
      
      // Explicitly set isAuthenticated based on the connected flag
      // This is the key fix to ensure consistency
      const isUserAuthenticated = settings.connected === true;
      setIsAuthenticated(isUserAuthenticated);
      console.log('Setting isAuthenticated to:', isUserAuthenticated);
      
      // If server and channel are selected, set them
      if (settings.selectedServerId && settings.selectedServerName) {
        setCurrentServer({
          id: settings.selectedServerId,
          name: settings.selectedServerName,
          icon: null
        });
        
        if (settings.selectedChannelId && settings.selectedChannelName) {
          setCurrentChannel({
            id: settings.selectedChannelId,
            name: settings.selectedChannelName,
            type: 2 // Voice channel type
          });
        }
        
        // Load channels for the selected server
        if (isUserAuthenticated) {
          await loadChannels(settings.selectedServerId);
        }
      }
      
      // Load servers if authenticated
      if (isUserAuthenticated) {
        console.log('User is authenticated, loading Discord servers');
        await loadServers();
        
        // Refresh connection status
        await refreshConnectionStatus();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load Discord settings';
      console.error('Error in loadSettings:', err);
      setError(message);
      // Set authenticated to false when there's an error
      setIsAuthenticated(false);
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  }, [loadChannels, loadServers, refreshConnectionStatus]);

  const handleDiscordCallback = useCallback(async (code: string, options?: DiscordCallbackOptions): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    try {
      const success = await discordService.handleCallback(code, options);
      if (success) {
        setIsAuthenticated(true);
        await loadSettings();
      }
      return success;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to authenticate with Discord';
      setError(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [loadSettings]);

  const completeDiscordHandoff = useCallback(async (handoff: string, verifier: string): Promise<DiscordHandoffResult> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await discordService.completeHandoff(handoff, verifier);
      if (result.success) {
        setIsAuthenticated(true);
        await loadSettings();
      }
      return result;
    } finally {
      setIsLoading(false);
    }
  }, [loadSettings]);

  const selectServer = useCallback((server: DiscordServer): void => {
    setCurrentServer(server);
    loadChannels(server.id);
  }, [loadChannels]);

  const selectChannel = useCallback((channel: DiscordChannel): void => {
    setCurrentChannel(channel);
  }, []);

  const saveSettings = useCallback(async (): Promise<boolean> => {
    if (!currentServer || !currentChannel) {
      setError('Server and channel must be selected');
      return false;
    }
    
    setIsLoading(true);
    setError(null);
    try {
      const success = await discordService.updateSettings({
        selectedServerId: currentServer.id,
        selectedServerName: currentServer.name,
        selectedChannelId: currentChannel.id,
        selectedChannelName: currentChannel.name
      });
      
      if (success) {
        // Update local state to reflect saved settings immediately
        setDiscordSettings(prevSettings => ({
          ...(prevSettings || {}),
          connected: prevSettings?.connected || isAuthenticated, // Persist existing auth status
          selectedServerId: currentServer.id,
          selectedServerName: currentServer.name,
          selectedChannelId: currentChannel.id,
          selectedChannelName: currentChannel.name,
          // isConnected should not be set here, refreshConnectionStatus will handle it
        } as DiscordSettings));
        // Refresh the actual connection status from the backend
        await refreshConnectionStatus();
      }
      
      return success;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save Discord settings';
      console.error('Error saving Discord settings:', err);
      setError(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [currentServer, currentChannel, isAuthenticated, refreshConnectionStatus]);

  const connect = useCallback(async (): Promise<boolean> => {
    // Prevent multiple connect attempts in rapid succession
    if (isLoading) {
      console.log('Connect operation already in progress, ignoring duplicate request');
      return false;
    }
    
    setIsLoading(true);
    setError(null);
    try {
      console.log('Attempting to connect to Discord voice channel');
      const success = await discordService.connect();
      
      if (success) {
        console.log('Successfully connected to Discord voice channel');
        // Optimistically set isConnected to true for faster UI feedback
        setIsConnected(true);
        // Refresh connection status to confirm and get full details
        // Consider reducing or removing timeout if backend updates quickly
        setTimeout(async () => {
          await refreshConnectionStatus();
        }, 500); // Reduced timeout
        return true;
      } else {
        console.log('Failed to connect to Discord voice channel');
        return false;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect to Discord';
      console.error('Error connecting to Discord:', err);
      setError(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, refreshConnectionStatus]);

  const disconnect = useCallback(async (): Promise<boolean> => {
    // Prevent multiple disconnect attempts in rapid succession
    if (isLoading) {
      console.log('Disconnect operation already in progress, ignoring duplicate request');
      return false;
    }
    
    setIsLoading(true);
    setError(null);
    try {
      console.log('Attempting to disconnect from Discord voice channel');
      const success = await discordService.disconnect();
      
      if (success) {
        console.log('Successfully disconnected from Discord voice channel');
        // Manual state update to ensure UI reflects disconnected state immediately
        setIsConnected(false);
        setConnectionStatus(null);
        
        // Wait a moment before refreshing connection status to allow the backend to update
        setTimeout(async () => {
          await refreshConnectionStatus();
        }, 1500);
        
        return true;
      } else {
        console.log('Failed to disconnect from Discord voice channel');
        return false;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to disconnect from Discord';
      console.error('Error disconnecting from Discord:', err);
      setError(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, refreshConnectionStatus]);


  const streamSpeech = useCallback(async (text: string, audioData?: string): Promise<boolean> => {
    if (!isConnected) {
      return false;
    }
    
    try {
      return await discordService.streamToDiscord(text, audioData);
    } catch (err) {
      console.error('Failed to stream speech to Discord:', err);
      return false;
    }
  }, [isConnected]);

  // Auto disconnect when app goes to background - moved after function declarations
  useEffect(() => {
    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      if (nextAppState === 'background' && isConnected) {
        console.log('App going to background, disconnecting from Discord');
        try {
          // Auto disconnect from Discord when app goes to background
          await disconnect();
        } catch (err) {
          console.error('Failed to disconnect from Discord on background:', err);
        }
      } else if (nextAppState === 'active' && 
                discordSettings?.selectedServerId &&
                discordSettings?.selectedChannelId) {
        // Optionally: Refresh connection status when app comes to foreground
        await refreshConnectionStatus();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [isConnected, discordSettings, disconnect, refreshConnectionStatus]);

  // Cold start from the OAuth callback deep link (the app was killed while the browser was
  // open): claim it app-wide right away instead of waiting for the Discord screen to mount.
  const handleDiscordCallbackRef = useRef(handleDiscordCallback);
  handleDiscordCallbackRef.current = handleDiscordCallback;
  useEffect(() => {
    consumeInitialDiscordCallbackUrl()
      .then(async (url) => {
        if (!url) return;
        const params = parseDiscordCallbackUrl(url);
        if (isDiscordCallbackError(params)) {
          const [title, message] = discordAuthFailureKeys(params.error);
          Alert.alert(t(title), t(message));
          return;
        }
        if (params.pending) {
          // A fresh process cannot hold the PKCE verifier of the flow that produced this
          // handoff (memory only): it cannot be completed, the user has to reconnect.
          const [title, message] = discordAuthFailureKeys('reconnect_needed');
          Alert.alert(t(title), t(message));
          return;
        }
        if (!params.code && !params.tempKey && params.status !== 'success') return;
        // Reloads the settings on success.
        const success = await handleDiscordCallbackRef.current(params.code ?? '', {
          tempKey: params.tempKey,
          linked: params.linked,
        });
        Alert.alert(
          t(success ? 'discord.authSuccess' : 'discord.authFailed'),
          t(success ? 'discord.authSuccessMessage' : 'discord.authFailedMessage')
        );
      })
      .catch((err) => console.error('Error handling Discord launch URL:', err));
  }, []);

  const contextValue = useMemo<DiscordContextType>(() => ({
    isConnected,
    isLoading,
    isAuthenticated,
    connectionStatus,
    discordSettings,
    servers,
    channels,
    currentServer,
    currentChannel,
    error,
    getDiscordAuthUrl,
    handleDiscordCallback,
    completeDiscordHandoff,
    loadServers,
    loadChannels,
    loadSettings,
    selectServer,
    selectChannel,
    saveSettings,
    connect,
    disconnect,
    refreshConnectionStatus,
    streamSpeech
  }), [
    isConnected,
    isLoading,
    isAuthenticated,
    connectionStatus,
    discordSettings,
    servers,
    channels,
    currentServer,
    currentChannel,
    error,
    getDiscordAuthUrl,
    handleDiscordCallback,
    completeDiscordHandoff,
    loadServers,
    loadChannels,
    loadSettings,
    selectServer,
    selectChannel,
    saveSettings,
    connect,
    disconnect,
    refreshConnectionStatus,
    streamSpeech
  ]);

  return (
    <DiscordContext.Provider value={contextValue}>
      {children}
    </DiscordContext.Provider>
  );
};

export const useDiscord = (): DiscordContextType => {
  const context = useContext(DiscordContext);
  if (context === undefined) {
    throw new Error('useDiscord must be used within a DiscordProvider');
  }
  return context;
}; 