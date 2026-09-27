import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

jest.mock('axios', () => {
  const isAxiosError = (e: any) => !!e?.isAxiosError;
  const instance = {
    post: jest.fn(),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, __instance: instance, default: { create: () => instance, isAxiosError }, isAxiosError };
});

import * as authApi from '../auth';
import { __resetMigrationForTests } from '../../services/secureStorage';

const instance = (jest.requireMock('axios') as any).__instance;
const mockPost = instance.post as jest.Mock;
const mockRequestUse = instance.interceptors.request.use as jest.Mock;

const secure = (SecureStore as any).__store as Map<string, string>;
const SECRET_ACCESS = 'eyJhbGciOiJkaXIi.SECRET-ACCESS-TOKEN';
const SECRET_REFRESH = 'SECRET-REFRESH-TOKEN';

const consoleMethods = ['log', 'info', 'debug', 'warn', 'error'] as const;
let spies: jest.SpyInstance[];
const allLogged = () => JSON.stringify(spies.flatMap((s) => s.mock.calls));

beforeEach(async () => {
  secure.clear();
  await AsyncStorage.clear();
  __resetMigrationForTests();
  mockPost.mockReset();
  spies = consoleMethods.map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => spies.forEach((s) => s.mockRestore()));

describe('api/auth logging + dead code', () => {
  it('never logs tokens (login/register success, and auth errors)', async () => {
    mockPost.mockResolvedValue({
      status: 200,
      headers: { authorization: `Bearer ${SECRET_ACCESS}` },
      data: { access_token: SECRET_ACCESS, refreshToken: SECRET_REFRESH },
    });
    await authApi.login({ email: 'a@b.c', password: 'pw' } as any);
    await authApi.register({ email: 'a@b.c', password: 'pw', name: 'n' } as any);
    mockPost.mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed',
      config: { headers: { Authorization: `Bearer ${SECRET_ACCESS}` } },
      response: { status: 401, data: { error: 'bad' }, headers: { 'set-cookie': SECRET_REFRESH } },
    });
    await expect(authApi.login({ email: 'a@b.c', password: 'pw' } as any)).rejects.toBeTruthy();
    expect(allLogged()).not.toContain('SECRET-');
  });

  it('dead Google/Apple code-exchange helpers are gone', () => {
    expect((authApi as any).loginWithGoogle).toBeUndefined();
    expect((authApi as any).loginWithApple).toBeUndefined();
  });
});
