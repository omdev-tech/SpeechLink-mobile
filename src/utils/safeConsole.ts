/**
 * Defence-in-depth for logs: release builds strip console.log/info/debug at build time
 * (babel.config.js), but console.warn/error still reach logcat / the iOS syslog. Many call
 * sites log raw errors, and an AxiosError carries `config.headers.Authorization` (the
 * Bearer token). This wraps the console so every argument is redacted before it is printed.
 */

const REDACTED = '[REDACTED]';
const METHODS = ['log', 'info', 'debug', 'warn', 'error'] as const;
const MAX_DEPTH = 6;
const MAX_STRING = 10_000;

// Keys whose string values are secrets (case-insensitive substring match).
const SECRET_KEY = /authorization|cookie|password|secret|token|verifier|tempkey|temp_key|handoff|api[-_]?key/i;

const STRING_PATTERNS: Array<[RegExp, string]> = [
  // Authorization header values
  [/\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi, `$1 ${REDACTED}`],
  // JWT / JWE compact serialisations (base64url JSON header "eyJ...")
  [/eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_.-]*/g, REDACTED],
  // Secret-bearing query/fragment params (OAuth code, temp keys, handoffs, tokens, state)
  [
    /([?&#](?:code|state|token|access_token|refresh_token|id_token|tempKey|temp_key|handoff|handoffCode|code_verifier)=)[^&#\s"']+/gi,
    `$1${REDACTED}`,
  ],
];

function redactString(value: string): string {
  // Redact first so truncation can never leave half a secret visible.
  const redacted = STRING_PATTERNS.reduce((s, [re, replacement]) => s.replace(re, replacement), value);
  return redacted.length > MAX_STRING
    ? `${redacted.slice(0, MAX_STRING)}…[truncated ${redacted.length - MAX_STRING} chars]`
    : redacted;
}

function isAxiosLikeError(value: any): boolean {
  return !!value && typeof value === 'object' && value.isAxiosError === true;
}

function summariseAxiosError(err: any): string {
  const request = [err.config?.method && String(err.config.method).toUpperCase(), err.config?.url]
    .filter(Boolean)
    .join(' ');
  const status = err.response?.status ?? 'no response';
  return redactString(`AxiosError: ${err.message} [${request || 'request'} -> ${status}]`);
}

export function redactForLog(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (isAxiosLikeError(value)) return summariseAxiosError(value);
  if (value instanceof Error) {
    const out = `${value.name}: ${redactString(value.message)}`;
    return value.stack ? `${out}\n${redactString(value.stack.split('\n').slice(1).join('\n'))}` : out;
  }
  // Binary payloads (audio buffers...) are summarised, never dumped.
  if (value instanceof ArrayBuffer) return `[ArrayBuffer ${value.byteLength}]`;
  if (ArrayBuffer.isView(value)) {
    const length = (value as any).length ?? value.byteLength;
    return `[${value.constructor?.name ?? 'TypedArray'} ${length}]`;
  }
  // `seen` tracks the current path only: a shared (non-cyclic) reference is printed each time.
  if (seen.has(value as object)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Object]';
  seen.add(value as object);
  try {
    if (Array.isArray(value)) return value.map((v) => redactForLog(v, depth + 1, seen));

    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = typeof v === 'string' && SECRET_KEY.test(key) ? REDACTED : redactForLog(v, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(value as object);
  }
}

const INSTALLED = Symbol.for('speechlink.safeConsole');

/** Wrap console methods so every argument is redacted. Idempotent. */
export function installSafeConsole(target: Console = console): void {
  const t = target as any;
  if (t[INSTALLED]) return;
  for (const method of METHODS) {
    const original = t[method];
    if (typeof original !== 'function') continue;
    t[method] = (...args: unknown[]) => {
      let safeArgs: unknown[];
      try {
        safeArgs = args.map((a) => redactForLog(a));
      } catch {
        safeArgs = ['[log redaction failed]'];
      }
      original.apply(target, safeArgs);
    };
  }
  t[INSTALLED] = true;
}
