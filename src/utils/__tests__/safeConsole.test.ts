import { installSafeConsole, redactForLog } from '../safeConsole';

const JWE = 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIn0..aGVsbG8.Y2lwaGVy.dGFn';

function fakeConsole() {
  return { log: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
}
/** Snapshot the underlying mocks before install (install replaces the methods with wrappers). */
const recorder = (c: ReturnType<typeof fakeConsole>) => {
  const fns = Object.values(c);
  return () => JSON.stringify(fns.flatMap((fn) => fn.mock.calls));
};

describe('safeConsole', () => {
  it('redacts Bearer headers, JWT/JWE strings and secret query params in strings', () => {
    const out = redactForLog(
      `Authorization: Bearer abc.def-ghi ; token ${JWE} ; url x://cb?tempKey=K123&code=C456&handoff=H1&ok=1`
    ) as string;
    expect(out).not.toMatch(/abc\.def-ghi|K123|C456|H1|aGVsbG8/);
    expect(out).toContain('ok=1');
  });

  it('redacts secret-looking keys in objects, keeping harmless fields', () => {
    const out = redactForLog({
      status: 401,
      code: 'ERR_BAD_REQUEST',
      access_token: 'S1',
      nested: { refreshToken: 'S2', headers: { Authorization: 'Bearer S3' }, tempKey: 'S4', password: 'S5' },
      hasAccessToken: true,
    }) as any;
    expect(JSON.stringify(out)).not.toMatch(/S[1-5]/);
    expect(out.status).toBe(401);
    expect(out.code).toBe('ERR_BAD_REQUEST');
    expect(out.hasAccessToken).toBe(true);
  });

  it('collapses axios errors (which carry config.headers.Authorization) to a safe summary', () => {
    const err: any = new Error('Request failed with status code 401');
    err.isAxiosError = true;
    err.config = { method: 'post', url: '/api/x?token=S9', headers: { Authorization: 'Bearer SECRETBEARER' } };
    err.request = { _headers: { authorization: 'Bearer SECRETBEARER' } };
    err.response = { status: 401, data: { error: 'nope', access_token: 'SECRETDATA' } };
    const c = fakeConsole();
    const dump = recorder(c);
    installSafeConsole(c as any);
    c.error('Logout failed:', err);
    const logged = dump();
    expect(logged).not.toMatch(/SECRETBEARER|SECRETDATA|S9/);
    expect(logged).toContain('401');
    expect(logged).toContain('Logout failed:');
  });

  it('handles cyclic objects without throwing', () => {
    const a: any = { name: 'x' };
    a.self = a;
    const c = fakeConsole();
    installSafeConsole(c as any);
    expect(() => c.warn(a)).not.toThrow();
  });

  it('is idempotent', () => {
    const c = fakeConsole();
    const original = c.log;
    installSafeConsole(c as any);
    installSafeConsole(c as any);
    c.log('hi');
    expect(original).toHaveBeenCalledTimes(1);
  });
});
