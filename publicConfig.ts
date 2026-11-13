// Only these public values may reach the browser. Never serialize process.env.
// The Supabase URL and the publishable key are designed to be public; the
// database password and the unlock secret are NOT in this list and never will be.
export function publicAppConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    supabaseUrl: (env.SUPABASE_URL ?? "").replace(/\/+$/, ""),
    supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY ?? "",
  };
}

export function publicAppConfigScript(env: NodeJS.ProcessEnv = process.env): string {
  const json = JSON.stringify(publicAppConfig(env)).replaceAll("<", "\\u003c");
  return `window.__APP_CONFIG__=${json};`;
}
