jest.mock('../apiService', () => ({
  apiService: { get: jest.fn(), post: jest.fn() },
}));

import { apiService } from '../apiService';
import { discordService } from '../discordService';

const post = apiService.post as jest.Mock;
const operations = () => post.mock.calls.map((c) => c[1].operation);

/** Fakes /api/discord/auth/mobile. `check-temp-keys` would leak ANY user's pending key. */
function fakeMobileAuth({ linked, validKey }: { linked: boolean; validKey?: string }) {
  post.mockImplementation(async (_url: string, body: any) => {
    switch (body.operation) {
      case 'check-auth':
        return { success: true, isAuthenticated: linked };
      case 'check-temp-keys':
        return { success: true, tempKey: 'someone-elses-key' };
      case 'verify-temp-key':
        return body.tempKey === validKey ? { success: true } : { error: 'invalid' };
      case 'process-code':
        return { success: true };
      default:
        return { error: 'Invalid operation' };
    }
  });
}

describe('discordService.handleCallback', () => {
  beforeEach(() => post.mockReset());

  it('claims the temp key handed back by the deep link (single request, no polling)', async () => {
    fakeMobileAuth({ linked: false, validKey: 'deep' });
    await expect(discordService.handleCallback('', { tempKey: 'deep', requireFreshAuth: true })).resolves.toBe(true);
    expect(operations()).toEqual(['verify-temp-key']);
  });

  it('a supplied temp key that fails to verify is a failure: no fallback at all', async () => {
    fakeMobileAuth({ linked: true, validKey: 'other' });
    await expect(discordService.handleCallback('', { tempKey: 'bad' })).resolves.toBe(false);
    expect(operations()).toEqual(['verify-temp-key']);
  });

  it('re-auth without key/code: an existing (stale) link is NOT success, and nothing is polled', async () => {
    fakeMobileAuth({ linked: true });
    await expect(discordService.handleCallback('', { requireFreshAuth: true })).resolves.toBe(false);
    expect(operations()).toEqual([]);
  });

  it('first connect without key/code: exactly one check-auth decides', async () => {
    fakeMobileAuth({ linked: true });
    await expect(discordService.handleCallback('')).resolves.toBe(true);
    expect(operations()).toEqual(['check-auth']);

    post.mockReset();
    fakeMobileAuth({ linked: false });
    await expect(discordService.handleCallback('')).resolves.toBe(false);
    expect(operations()).toEqual(['check-auth']);
  });

  it('exchanges a code handed back by the deep link', async () => {
    fakeMobileAuth({ linked: false });
    await expect(discordService.handleCallback('the-code')).resolves.toBe(true);
    expect(post).toHaveBeenCalledWith('/api/discord/auth/mobile', { operation: 'process-code', code: 'the-code' });
  });

  it('never asks the server for "any pending temp key" (check-temp-keys is not user-scoped)', async () => {
    fakeMobileAuth({ linked: false });
    await discordService.handleCallback('');
    await discordService.handleCallback('', { requireFreshAuth: true });
    await discordService.handleCallback('', { tempKey: 'bad' });
    expect(operations()).not.toContain('check-temp-keys');
    expect((discordService as any).checkPendingAuth).toBeUndefined();
  });

  it('linked (new backend: code already exchanged for this user) is a confirmed fresh link, no request', async () => {
    fakeMobileAuth({ linked: false });
    await expect(discordService.handleCallback('', { linked: true, requireFreshAuth: true })).resolves.toBe(true);
    await expect(discordService.handleCallback('', { linked: true, tempKey: 'ignored' })).resolves.toBe(true);
    expect(operations()).toEqual([]);
  });
});
