/**
 * The app is usable without a database (empty campus, admin can build one),
 * so a missing or unreachable DATABASE_URL is an expected configuration state,
 * not a server fault. Read endpoints use these helpers to answer with an empty
 * payload instead of a 500.
 */

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim());
}

const CONNECTION_ERROR_MARKERS = [
  "Environment variable not found: DATABASE_URL",
  "the URL must start with the protocol",
  "Can't reach database server",
  "Connection refused",
  "ECONNREFUSED",
  "ENOTFOUND",
];

/** True when the failure is "no database available" rather than a real query bug. */
export function isDatabaseUnavailableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return CONNECTION_ERROR_MARKERS.some((marker) => message.includes(marker));
}

export const DATABASE_UNCONFIGURED_MESSAGE =
  "No database configured. Set DATABASE_URL in .env and run `pnpm db:migrate` to persist campus data.";
