/**
 * Comma-separated allowlist of Clerk-account emails that are auto-promoted
 * to `isAdmin = true` on first login (and re-asserted on every
 * `getOrCreateUser` call so the flag self-heals if the column is wiped).
 * Falls back to `c.borawa@gmail.com` so the project owner always gets
 * super-user without needing to set an env var.
 *
 * Set `SUPER_USER_EMAILS="a@b.com,c@d.com"` to add more admins. Emails
 * are compared case-insensitively after trim.
 */
const RAW = process.env["SUPER_USER_EMAILS"] ?? "c.borawa@gmail.com";

export const SUPER_USER_EMAILS: ReadonlySet<string> = new Set(
  RAW.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0),
);

export function isSuperUserEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return SUPER_USER_EMAILS.has(email.trim().toLowerCase());
}
