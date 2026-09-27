/**
 * Deep link the backend's /api/discord/callback page sends the in-app browser to at the
 * end of the mobile Discord OAuth flow. Passed to WebBrowser.openAuthSessionAsync, which
 * closes the Custom Tab / ASWebAuthenticationSession as soon as a URL starting with it is
 * opened. Scheme = app.json `expo.scheme` (Android intent filter in app.plugin.js).
 *
 * Contract (query parameters, all optional):
 *   status  = "success" | "error"
 *   tempKey = key of the TempDiscordAuth row the callback stored (claimed via verify-temp-key).
 *             REQUIRED whenever the callback stored the code instead of exchanging it: the app
 *             never asks for "any pending key", and a re-auth (Refresh connection) only succeeds
 *             with a tempKey or code.
 *   code    = raw Discord OAuth code (exchanged via process-code), if the backend did not store it
 *   error   = Discord/OAuth error (e.g. "access_denied"); implies failure
 */
export const DISCORD_OAUTH_REDIRECT_URL = 'com.naqued.speechlinkmobile://discord-callback';

export interface DiscordCallbackParams {
  status?: string;
  tempKey?: string;
  code?: string;
  error?: string;
}

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
  };
}

/** True when the backend reported a failure in the deep link. */
export function isDiscordCallbackError(params: DiscordCallbackParams): boolean {
  return params.status === 'error' || !!params.error;
}
