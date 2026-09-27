/**
 * Deep link the backend's /api/discord/callback page sends the in-app browser to at the
 * end of the mobile Discord OAuth flow. Passed to WebBrowser.openAuthSessionAsync, which
 * closes the Custom Tab / ASWebAuthenticationSession as soon as a URL starting with it is
 * opened. Scheme = app.json `expo.scheme` (Android intent filter in app.plugin.js).
 *
 * Contract (query parameters, all optional):
 *   status  = "pending" | "success" | "error"
 *   handoff = with status=pending (current backend, PKCE): 43 base64url chars. The app completes
 *             it with POST /api/discord/auth/mobile {operation:'complete-handoff', handoff,
 *             verifier}, and only while it holds the verifier of a flow THIS app instance
 *             started (otherwise the link is ignored and the user asked to reconnect).
 *   linked  = "1" with status=success: the backend (signed OAuth state bound to the calling
 *             user) already exchanged the code for that user, so the link is confirmed and
 *             FRESH (counts even for a re-auth). Current backend: `?status=success&linked=1`.
 *   tempKey = (older backend, kept for the transition) key of the TempDiscordAuth row the
 *             callback stored, claimed via verify-temp-key. The app never asks for "any pending
 *             key"; without linked=1, tempKey or code a re-auth (Refresh connection) cannot be
 *             confirmed and a first connect falls back to one check-auth.
 *   code    = raw Discord OAuth code (exchanged via process-code), if the backend did not store it
 *   error   = Discord/OAuth error (e.g. "access_denied"); implies failure
 */
export const DISCORD_OAUTH_REDIRECT_URL = 'com.naqued.speechlinkmobile://discord-callback';

export interface DiscordCallbackParams {
  status?: string;
  tempKey?: string;
  code?: string;
  error?: string;
  /** status=success&linked=1: the backend already linked the account for this user. */
  linked: boolean;
  /** status=pending: the backend is waiting for complete-handoff. */
  pending: boolean;
  /** Only set with status=pending and a well-formed value (43 base64url chars). */
  handoff?: string;
}

const HANDOFF_FORMAT = /^[A-Za-z0-9_-]{43}$/;

/** Parses the query string of a discord-callback deep link (no reliance on URL/searchParams). */
export function parseDiscordCallbackUrl(url: string): DiscordCallbackParams {
  const query = url.split('#')[0].split('?')[1] ?? '';
  const params: Record<string, string> = {};
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const [rawKey, ...rest] = pair.split('=');
    try {
      params[decodeURIComponent(rawKey)] = decodeURIComponent(rest.join('=').replace(/\+/g, ' '));
    } catch {
      // Malformed escape sequence: ignore this parameter.
    }
  }
  return {
    status: params.status || undefined,
    tempKey: params.tempKey || undefined,
    code: params.code || undefined,
    error: params.error || undefined,
    linked: params.status === 'success' && params.linked === '1',
    pending: params.status === 'pending',
    handoff:
      params.status === 'pending' && HANDOFF_FORMAT.test(params.handoff ?? '') ? params.handoff : undefined,
  };
}

/** True when the backend reported a failure in the deep link. */
export function isDiscordCallbackError(params: DiscordCallbackParams): boolean {
  return params.status === 'error' || !!params.error;
}
