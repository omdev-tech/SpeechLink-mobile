jest.mock('../apiService', () => ({
  apiService: { get: jest.fn(), post: jest.fn() },
}));

import { apiService } from '../apiService';
import { discordService } from '../discordService';

const post = apiService.post as jest.Mock;
const operations = () => post.mock.calls.map((c) => c[1].operation);

/** Fakes /api/discord/auth/mobile. */
function fakeMobileAuth({ linked, pendingKey }: { linked: boolean; pendingKey?: string }) {
  post.mockImplementation(async (_url: string, body: any) => {
    switch (body.operation) {
      case 'check-auth':
        return { success: true, isAuthenticated: linked };
      case 'check-temp-keys':
        return pendingKey ? { success: true, tempKey: pendingKey } : { success: false };
      case 'verify-temp-key':
        return body.tempKey === pendingKey ? { success: true } : { error: 'invalid' };
      default:
        return { error: 'Invalid operation' };
    }
  });
}

describe('discordService.handleCallback', () => {
  beforeEach(() => post.mockReset());

  it('re-auth: claims the pending temp key even though an (old) link already exists', async () => {
    fakeMobileAuth({ linked: true, pendingKey: 'k1' });
    await expect(discordService.handleCallback('', { requireFreshAuth: true, maxAttempts: 1 })).resolves.toBe(true);
    expect(operations()).toEqual(['check-temp-keys', 'verify-temp-key']);
  });

  it('re-auth: an existing link alone is NOT success (old tokens would stay in place)', async () => {
    fakeMobileAuth({ linked: true });
    await expect(discordService.handleCallback('', { requireFreshAuth: true, maxAttempts: 1 })).resolves.toBe(false);
    expect(operations()).not.toContain('check-auth');
  });

  it('first connect: an existing link counts as success (web-session callback path)', async () => {
    fakeMobileAuth({ linked: true });
    await expect(discordService.handleCallback('', { maxAttempts: 1 })).resolves.toBe(true);
  });

  it('claims the temp key handed back by the deep link without polling', async () => {
    fakeMobileAuth({ linked: false, pendingKey: 'deep' });
    await expect(discordService.handleCallback('', { tempKey: 'deep', requireFreshAuth: true })).resolves.toBe(true);
    expect(operations()).toEqual(['verify-temp-key']);
  });

  it('exchanges a code handed back by the deep link', async () => {
    post.mockResolvedValue({ success: true });
    await expect(discordService.handleCallback('the-code')).resolves.toBe(true);
    expect(post).toHaveBeenCalledWith('/api/discord/auth/mobile', { operation: 'process-code', code: 'the-code' });
  });
});
