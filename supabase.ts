import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function isSupabaseConfigured() {
  const config = window.__APP_CONFIG__;
  return Boolean(config?.supabaseUrl && config?.supabasePublishableKey);
}

/** The one shared Supabase connection for sign-up, log-in and log-out. */
export function getSupabase(): SupabaseClient {
  if (!client) {
    const config = window.__APP_CONFIG__;
    if (!config?.supabaseUrl || !config?.supabasePublishableKey) {
      throw new Error("Sign-in is not set up yet. The site needs its Supabase settings added.");
    }
    client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}
