import { useState, type FormEvent } from "react";
import { ChevronRight, LockKeyhole, ShieldCheck, Star } from "lucide-react";

export default function ParentPinGate({
  mode,
  busy,
  onSubmit,
  onSignOut,
}: {
  mode: "setup" | "unlock";
  busy: boolean;
  onSubmit: (pin: string) => void;
  onSignOut: () => void;
}) {
  const [pin, setPin] = useState("");
  const isSetup = mode === "setup";

  function submit(event: FormEvent) {
    event.preventDefault();
    if (/^\d{6}$/.test(pin)) onSubmit(pin);
  }

  return (
    <main className="auth-screen">
      <section className="auth-card pin-gate-card">
        <img className="brand-mark" src="/favicon.svg" alt="" />
        <p className="eyebrow">GROWN-UP ACCESS</p>
        <h1>{isSetup ? "Set your family’s PIN." : "A grown-up, please."}</h1>
        <p className="auth-copy">{isSetup
          ? "Choose a six-digit PIN. It keeps parent settings and saved surprises tucked away when your child is using the countdown."
          : "Enter the six-digit PIN to open parent settings, progress, and saved surprises."}</p>
        <form className="pin-gate-form" onSubmit={submit}>
          <label className="field-label" htmlFor="parent-pin">Six-digit grown-up PIN</label>
          <input
            id="parent-pin"
            className="text-input pin-input"
            type="password"
            inputMode="numeric"
            autoComplete={isSetup ? "new-password" : "current-password"}
            pattern="[0-9]{6}"
            minLength={6}
            maxLength={6}
            value={pin}
            onChange={event => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
            required
          />
          <button className="button button-primary button-wide" type="submit" disabled={busy || pin.length !== 6}>
            {isSetup ? <ShieldCheck size={17} /> : <LockKeyhole size={17} />}
            {busy ? "One moment…" : isSetup ? "Set grown-up PIN" : "Unlock parent view"}
            <ChevronRight size={17} />
          </button>
        </form>
        <div className="auth-assurances"><span><LockKeyhole size={16} /> Parent controls locked</span><span><Star size={16} /> Child view stays read-only</span></div>
        <p className="auth-footnote">Your PIN is stored as a salted hash, not as readable digits. Parent access expires after a while and locks as soon as child view opens.</p>
        <button className="text-button pin-signout" type="button" onClick={onSignOut}>Sign out</button>
      </section>
      <div className="auth-art"><img src="/manus-storage/async-images/27V2WxKsMY57Gr0gMsRiMb/image-1.webp" alt="A cheerful winter helper beside a starry countdown planner" /></div>
    </main>
  );
}
