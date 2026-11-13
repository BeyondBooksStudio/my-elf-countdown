import { useState, type FormEvent } from "react";
import { ChevronRight } from "lucide-react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

type Mode = "login" | "signup";

function friendlyError(message: string): string {
  const text = message.toLowerCase();
  if (text.includes("invalid login credentials")) return "That email and password don’t match. Please try again.";
  if (text.includes("email not confirmed")) return "Please confirm your email first. Check your inbox for our message.";
  if (text.includes("already registered") || text.includes("already been registered")) return "That email already has an account. Try logging in instead.";
  if (text.includes("password") && text.includes("least")) return "Please choose a password with at least 8 characters.";
  if (text.includes("rate limit") || text.includes("too many")) return "Too many tries just now. Please wait a minute and try again.";
  if (text.includes("fetch") || text.includes("network")) return "We couldn’t reach the sign-in service. Check your internet and try again.";
  return message || "Something went wrong. Please try again.";
}

export default function AuthForm() {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const isSignup = mode === "signup";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!isSupabaseConfigured()) { setError("Sign-in is not set up yet. The site needs its Supabase settings added."); return; }
    if (isSignup && password.length < 8) { setError("Please choose a password with at least 8 characters."); return; }
    setBusy(true);
    try {
      const supabase = getSupabase();
      if (isSignup) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: name.trim() ? { display_name: name.trim().slice(0, 80) } : {} },
        });
        if (signUpError) throw signUpError;
        if (data.user && data.user.identities && data.user.identities.length === 0) {
          setError("That email already has an account. Try logging in instead.");
        } else if (!data.session) {
          // Happens when "Confirm email" is switched on in Supabase.
          setNotice("Almost there! We’ve sent you an email. Open it and tap the link to confirm, then come back and log in.");
          setMode("login");
          setPassword("");
        }
        // With no confirmation step, Supabase signs the parent straight in.
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (signInError) throw signInError;
      }
    } catch (reason) {
      setError(friendlyError(reason instanceof Error ? reason.message : ""));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="pin-gate-form" onSubmit={submit} noValidate={false}>
        {isSignup && (
          <>
            <label className="field-label" htmlFor="auth-name">Your first name (optional)</label>
            <input id="auth-name" className="text-input" type="text" autoComplete="given-name" maxLength={80}
              value={name} onChange={event => setName(event.target.value)} />
          </>
        )}
        <label className="field-label" htmlFor="auth-email">Email</label>
        <input id="auth-email" className="text-input" type="email" inputMode="email" autoComplete="email" required
          value={email} onChange={event => setEmail(event.target.value)} />
        <label className="field-label" htmlFor="auth-password">Password</label>
        <input id="auth-password" className="text-input" type="password" required minLength={isSignup ? 8 : undefined}
          autoComplete={isSignup ? "new-password" : "current-password"}
          value={password} onChange={event => setPassword(event.target.value)} />
        {isSignup && <p className="auth-footnote">Use at least 8 characters.</p>}
        <button className="button button-primary button-wide" type="submit" disabled={busy || !email || !password}>
          {busy ? "One moment…" : isSignup ? "Create my account" : "Log in"}
          <ChevronRight size={18} />
        </button>
      </form>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {notice && <p className="auth-footnote" role="status">{notice}</p>}
      <button className="text-button pin-signout" type="button" disabled={busy}
        onClick={() => { setMode(isSignup ? "login" : "signup"); setError(""); setNotice(""); }}>
        {isSignup ? "I already have an account. Log in" : "New here? Create an account"}
      </button>
    </>
  );
}
