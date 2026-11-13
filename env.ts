// Server-side settings. They are read when needed, so Netlify's environment
// variables are picked up without rebuilding. Never print or expose these values.
export const ENV = {
  /** Postgres connection string from Supabase (Connect > Transaction pooler). SECRET. */
  get databaseUrl() { return process.env.DATABASE_URL ?? ""; },
  /** e.g. https://your-project.supabase.co  (public) */
  get supabaseUrl() { return (process.env.SUPABASE_URL ?? "").replace(/\/+$/, ""); },
  /** The "publishable" key (sb_publishable_...). Safe to be public. */
  get supabasePublishableKey() { return process.env.SUPABASE_PUBLISHABLE_KEY ?? ""; },
  /** Random secret (32+ characters) that signs the short-lived parent-PIN unlock cookie. SECRET. */
  get unlockSecret() { return process.env.PARENT_UNLOCK_SECRET ?? ""; },
  get isProduction() { return process.env.NODE_ENV === "production"; },
};
