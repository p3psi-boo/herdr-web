import { useId, useState } from "react";
import { appClient } from "../ws.ts";
import { focusRing, tap } from "../ui.tsx";

export function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordId = useId();
  const errorId = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    const authenticated = await appClient.login(password);
    setBusy(false);
    if (!authenticated) {
      setError("密码错误，或服务暂时不可达");
      return;
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-canvas">
      <form
        onSubmit={submit}
        className="w-[20rem] rounded-[20px] bg-surface p-6 shadow-sheet"
      >
        <div className="mb-1 text-[22px] font-semibold tracking-tight text-ink">herdr-web</div>
        <div className="mb-5 text-[15px] text-ink-secondary">输入密码以继续</div>
        <label htmlFor={passwordId} className="mb-1 block text-[13px] font-semibold text-ink-tertiary">
          密码
        </label>
        <input
          id={passwordId}
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="mb-3 w-full rounded-xl bg-canvas px-3 py-2.5 text-base text-ink outline-none placeholder:text-ink-tertiary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:text-[15px]"
        />
        {error && (
          <div id={errorId} className="mb-3 text-[13px] text-danger">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={busy}
          className={`w-full rounded-xl bg-accent px-3 py-2.5 text-[15px] font-medium text-accent-fg disabled:opacity-40 ${tap} ${focusRing}`}
        >
          {busy ? "登录中…" : "登录"}
        </button>
      </form>
    </div>
  );
}
