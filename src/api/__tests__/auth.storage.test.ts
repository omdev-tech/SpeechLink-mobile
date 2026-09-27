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

describe('api/auth token storage', () => {
  it('login stores the token in SecureStore and leaves nothing in AsyncStorage', async () => {
    mockPost.mockResolvedValue({ status: 200, data: { access_token: SECRET_ACCESS, user: { id: 'u1' } } });
    await authApi.login({ email: 'a@b.c', password: 'pw' } as any);
    expect(await AsyncStorage.getItem('auth_token')).toBeNull();
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
    expect([...secure.values()].join('')).toContain(SECRET_ACCESS);
  });

  it('register with access+refresh stores both in SecureStore only', async () => {
    mockPost.mockResolvedValue({
      status: 200,
      data: { accessToken: SECRET_ACCESS, refreshToken: SECRET_REFRESH, user: { id: 'u1' } },
    });
    await authApi.register({ email: 'a@b.c', password: 'pw', name: 'n' } as any);
    expect(await AsyncStorage.getItem('auth_token')).toBeNull();
    expect(await AsyncStorage.getItem('refresh_token')).toBeNull();
    const all = [...secure.values()].join('');
    expect(all).toContain(SECRET_ACCESS);
    expect(all).toContain(SECRET_REFRESH);
  });

  it('the request interceptor reads the bearer token from SecureStore', async () => {
    mockPost.mockResolvedValue({ status: 200, data: { access_token: SECRET_ACCESS } });
    await authApi.login({ email: 'a@b.c', password: 'pw' } as any);
    const interceptor = mockRequestUse.mock.calls[0][0];
    const config = await interceptor({ headers: {} });
    expect(config.headers.Authorization).toBe(`Bearer ${SECRET_ACCESS}`);
  });

  it('logout clears SecureStore even when the API call fails', async () => {
    mockPost.mockResolvedValueOnce({ status: 200, data: { accessToken: SECRET_ACCESS, refreshToken: SECRET_REFRESH } });
    await authApi.login({ email: 'a@b.c', password: 'pw' } as any);
    mockPost.mockRejectedValueOnce(new Error('network'));
    await expect(authApi.logout()).rejects.toThrow('network');
    expect(secure.size).toBe(0);
  });
});
