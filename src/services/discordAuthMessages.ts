/**
 * i18n keys [title, message] for the outcome of a Discord connect attempt, keyed by the
 * backend/OAuth error code (deep link `error=` or API `code`).
 */
export type DiscordAuthFailure =
  | 'access_denied'
  | 'rate_limited'
  | 'exchange_failed'
  | 'reconnect_needed'
  | string
  | undefined;

export function discordAuthFailureKeys(code: DiscordAuthFailure): [string, string] {
  switch (code) {
    case 'access_denied':
      return ['discord.authCancelled', 'discord.authCancelledMessage'];
    case 'rate_limited':
      return ['discord.authFailed', 'discord.rateLimited'];
    case 'exchange_failed':
      return ['discord.authFailed', 'discord.authRetry'];
    case 'reconnect_needed':
      return ['discord.authFailed', 'discord.reconnectNeeded'];
    default:
      return ['discord.authFailed', 'discord.authFailedMessage'];
  }
}
