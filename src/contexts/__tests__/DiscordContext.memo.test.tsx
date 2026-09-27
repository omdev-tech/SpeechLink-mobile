jest.mock('../../services/discordService', () => ({
  discordService: {
    getSettings: jest.fn().mockResolvedValue({ connected: false, isConnected: false }),
    getConnectionStatus: jest.fn().mockResolvedValue({ isConnected: false }),
  },
}));

import React, { useState } from 'react';
import { Text } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { DiscordProvider, useDiscord } from '../DiscordContext';

describe('DiscordProvider memoization', () => {
  it('keeps the context value and its functions stable across unrelated parent re-renders', async () => {
    const seen: ReturnType<typeof useDiscord>[] = [];
    const Consumer = () => {
      seen.push(useDiscord());
      return null;
    };
    let bump: () => void = () => {};
    const Parent = () => {
      const [n, setN] = useState(0);
      bump = () => setN((x) => x + 1);
      return (
        <DiscordProvider>
          <Text>{n}</Text>
          <Consumer />
        </DiscordProvider>
      );
    };

    render(<Parent />);
    // Let the mount-time loadSettings settle.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const before = seen[seen.length - 1];

    await act(async () => bump());
    await act(async () => bump());
    const after = seen[seen.length - 1];

    expect(after).toBe(before);
    for (const key of ['handleDiscordCallback', 'loadSettings', 'getDiscordAuthUrl', 'disconnect', 'connect'] as const) {
      expect(after[key]).toBe(before[key]);
    }
  });
});
