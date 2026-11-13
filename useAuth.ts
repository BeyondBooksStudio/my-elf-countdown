import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";

/** Who is signed in, using Supabase's own login session (kept safely in the browser). */
export function useAuth() {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setError(new Error("Sign-in is not set up yet."));
      setLoading(false);
      return;
    }
    const supabase = getSupabase();
    let active = true;
    supabase.auth.getSession()
      .then(({ data }) => { if (active) setSession(data.session); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason : new Error("Could not check sign-in.")); })
      .finally(() => { if (active) setLoading(false); });
    // Fires on sign-in, sign-out and automatic token refresh.
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  const user = useMemo(() => {
    if (!session?.user) return null;
    const metadata = session.user.user_metadata as Record<string, unknown> | undefined;
    const displayName = typeof metadata?.display_name === "string" ? metadata.display_name.trim() : "";
    return {
      id: session.user.id,
      email: session.user.email ?? null,
      name: displayName || session.user.email?.split("@")[0] || null,
    };
  }, [session]);

  const logout = useCallback(async () => {
    const { error: signOutError } = await getSupabase().auth.signOut();
    // Even if the network call failed, forget the saved session on this device.
    if (signOutError) await getSupabase().auth.signOut({ scope: "local" });
    queryClient.clear();
  }, [queryClient]);

  return { user, loading, error, isAuthenticated: Boolean(user), logout };
}
