import {
  DISCORD_OAUTH_REDIRECT_URL,
  isDiscordCallbackError,
  parseDiscordCallbackUrl,
} from '../discordOAuthRedirect';

const appJson = require('../../../app.json');

describe('discord OAuth redirect deep link', () => {
  it('uses the app scheme declared in app.json and the path handleDeepLink matches', () => {
    expect(DISCORD_OAUTH_REDIRECT_URL).toBe(`${appJson.expo.scheme}://discord-callback`);
  });

  it('parses status / tempKey / code / error', () => {
    expect(parseDiscordCallbackUrl(`${DISCORD_OAUTH_REDIRECT_URL}?status=success&tempKey=a%2Bb&code=c#frag`)).toEqual({
      status: 'success',
      tempKey: 'a+b',
      code: 'c',
      error: undefined,
      linked: false,
      pending: false,
    });
    expect(parseDiscordCallbackUrl(DISCORD_OAUTH_REDIRECT_URL)).toEqual({ linked: false, pending: false });
  });

  it('flags errors', () => {
    expect(isDiscordCallbackError(parseDiscordCallbackUrl(`${DISCORD_OAUTH_REDIRECT_URL}?status=error`))).toBe(true);
    expect(isDiscordCallbackError(parseDiscordCallbackUrl(`${DISCORD_OAUTH_REDIRECT_URL}?error=access_denied`))).toBe(true);
    expect(isDiscordCallbackError(parseDiscordCallbackUrl(`${DISCORD_OAUTH_REDIRECT_URL}?status=success`))).toBe(false);
  });

  it('parses linked=1 (backend already exchanged the code for the signed-in user)', () => {
    expect(parseDiscordCallbackUrl(`${DISCORD_OAUTH_REDIRECT_URL}?status=success&linked=1`)).toMatchObject({
      status: 'success',
      linked: true,
    });
    expect(parseDiscordCallbackUrl(`${DISCORD_OAUTH_REDIRECT_URL}?status=success&linked=0`).linked).toBe(false);
    // linked only counts together with a success status
    expect(parseDiscordCallbackUrl(`${DISCORD_OAUTH_REDIRECT_URL}?status=error&linked=1`).linked).toBe(false);
  });
});

describe('pending handoff links', () => {
  const H = 'aB3_-'.repeat(8) + 'xyz'; // 43 base64url chars
  it('parses status=pending&handoff=<43 base64url>', () => {
    expect(parseDiscordCallbackUrl(`${DISCORD_OAUTH_REDIRECT_URL}?status=pending&handoff=${H}`)).toMatchObject({
      pending: true,
      handoff: H,
      linked: false,
    });
  });
  it.each(['short', `${H}x`, `${H.slice(0, 42)}=`, `${H.slice(0, 42)}%2F`])('rejects a malformed handoff (%s)', (h) => {
    expect(parseDiscordCallbackUrl(`${DISCORD_OAUTH_REDIRECT_URL}?status=pending&handoff=${h}`).handoff).toBeUndefined();
  });
  it('handoff only counts with status=pending', () => {
    expect(parseDiscordCallbackUrl(`${DISCORD_OAUTH_REDIRECT_URL}?status=success&handoff=${H}`)).toMatchObject({ pending: false });
    expect(parseDiscordCallbackUrl(`${DISCORD_OAUTH_REDIRECT_URL}?status=success&handoff=${H}`).handoff).toBeUndefined();
  });
});

