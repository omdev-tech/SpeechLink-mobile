import { Linking } from 'react-native';
import { DISCORD_OAUTH_REDIRECT_URL } from './discordOAuthRedirect';

/**
 * Process-wide bookkeeping for discord-callback deep links, shared by DiscordProvider
 * (cold-start launch URL) and DiscordSettingsScreen (runtime links / auth session), so a
 * URL delivered more than once (auth session result + Linking on Android, a late
 * duplicate, the launch URL that getInitialURL() keeps returning) is acted on once.
 */
const handledCallbackUrls = new Set<string>();
let initialUrlConsumed = false;

export function isDiscordCallbackUrl(url: string | null | undefined): url is string {
  return !!url && url.startsWith(DISCORD_OAUTH_REDIRECT_URL);
}

/** Marks a discord-callback URL as handled; false if it already was. */
export function claimCallbackUrl(url: string): boolean {
  if (handledCallbackUrls.has(url)) return false;
  handledCallbackUrls.add(url);
  return true;
}

/** Called when a new auth session starts: an identical `?status=...` link may legitimately recur. */
export function clearHandledCallbackUrls(): void {
  handledCallbackUrls.clear();
}

/**
 * The app's launch URL if it is a not-yet-handled discord-callback link, else null.
 * getInitialURL() returns the launch URL for the whole process life: only asked once.
 */
export async function consumeInitialDiscordCallbackUrl(): Promise<string | null> {
  if (initialUrlConsumed) return null;
  initialUrlConsumed = true;
  const url = await Linking.getInitialURL();
  return isDiscordCallbackUrl(url) && claimCallbackUrl(url) ? url : null;
}

/** Test-only: forget every handled URL and allow the launch URL to be read again. */
export function resetDiscordCallbackLinksForTests(): void {
  handledCallbackUrls.clear();
  initialUrlConsumed = false;
}
