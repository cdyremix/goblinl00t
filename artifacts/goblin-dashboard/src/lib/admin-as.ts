/**
 * Module-level store for the admin "control as" channel override.
 *
 * When an admin navigates to any page with `?as=channelname`, this store is
 * populated on mount so that every API call (both reads and writes) appends
 * the ?as= param automatically via `withAdminAs()`.
 *
 * Single-tab assumption: module-level state is fine because the admin is
 * operating exactly one impersonated context per browser tab.
 */

let _adminAs: string | null = null;

export function setAdminAs(channel: string | null): void {
  _adminAs = channel ? channel.trim().toLowerCase() : null;
}

export function getAdminAs(): string | null {
  return _adminAs;
}

/**
 * Appends `?as=<channel>` (or `&as=<channel>`) to a URL when the admin
 * impersonation store is set.  Returns the URL unchanged otherwise.
 */
export function withAdminAs(url: string): string {
  if (!_adminAs) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}as=${encodeURIComponent(_adminAs)}`;
}
