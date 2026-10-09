jest.mock('../../config/api', () => ({ API_CONFIG: { BASE_URL: 'https://api.test' } }));

import { authService } from '../authService';

const fetchMock = jest.fn();
const respond = (status: number, body: unknown = {}) =>
  fetchMock.mockResolvedValueOnce({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  jest.restoreAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock as any;
  (authService as any).token = { access_token: 'tok', token_type: 'bearer' };
  jest.spyOn(authService, 'clearToken').mockResolvedValue(undefined as any);
});

describe('authService.deleteAccount', () => {
  it('sends DELETE /api/account with the Bearer token and body, then clears the session', async () => {
    respond(200, { success: true });
    await expect(authService.deleteAccount({ lang: 'fr' })).resolves.toEqual({ status: 'deleted' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/api/account');
    expect(init.method).toBe('DELETE');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ lang: 'fr' });
    expect(authService.clearToken).toHaveBeenCalled();
  });

  it('reports Apple re-authentication without clearing the session', async () => {
    respond(409, { code: 'APPLE_REAUTH_REQUIRED' });
    await expect(authService.deleteAccount()).resolves.toEqual({ status: 'appleReauthRequired' });
    expect(authService.clearToken).not.toHaveBeenCalled();
  });

  it('passes the server error code through, or the HTTP status', async () => {
    respond(502, { code: 'SUBSCRIPTION_CANCEL_FAILED' });
    await expect(authService.deleteAccount()).resolves.toEqual({ status: 'failed', code: 'SUBSCRIPTION_CANCEL_FAILED' });
    respond(404);
    await expect(authService.deleteAccount()).resolves.toEqual({ status: 'failed', code: 'HTTP_404' });
    expect(authService.clearToken).not.toHaveBeenCalled();
  });

  it('fails without calling the server when signed out, and on network errors', async () => {
    (authService as any).token = null;
    jest.spyOn(authService, 'getToken').mockResolvedValueOnce(null);
    await expect(authService.deleteAccount()).resolves.toEqual({ status: 'failed', code: 'NOT_SIGNED_IN' });
    expect(fetchMock).not.toHaveBeenCalled();

    (authService as any).token = { access_token: 'tok' };
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(authService.deleteAccount()).resolves.toEqual({ status: 'failed', code: 'NETWORK' });
  });
});
