"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { Logo } from "@/components/layout/logo";

export default function SignInPage() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signUp");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Mirror the server rule (Password provider requires >= 8 chars) so the user
  // hears the real reason instantly, before a round-trip.
  function validate(email: string, password: string): string | null {
    if (!email) return "Enter your email address.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return "That doesn't look like a valid email address.";
    }
    if (!password) return "Enter a password.";
    if (flow === "signUp" && password.length < 8) {
      return "Password must be at least 8 characters.";
    }
    return null;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const formData = new FormData(e.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    const problem = validate(email, password);
    if (problem) {
      setError(problem);
      return;
    }

    setPending(true);
    formData.set("email", email);
    formData.set("flow", flow);
    try {
      await signIn("password", formData);
      router.push("/dashboard");
    } catch {
      // The server error is intentionally opaque; give the likely cause + a next step.
      setError(
        flow === "signUp"
          ? "Couldn't create the account. This email may already be registered — try signing in instead."
          : "Wrong email or password. Check both and try again.",
      );
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <Logo />

        <h1 className="mt-10 font-display text-3xl text-bone">
          {flow === "signUp" ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {flow === "signUp"
            ? "Start building your AI assistant in minutes."
            : "Sign in to your Omnivo AI dashboard."}
        </p>

        <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-3">
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@business.com"
            className="h-12 rounded-lg border border-line-strong bg-surface px-4 text-sm text-bone placeholder:text-faint focus-visible:border-ember"
          />
          <div>
            <input
              name="password"
              type="password"
              required
              minLength={flow === "signUp" ? 8 : undefined}
              autoComplete={flow === "signUp" ? "new-password" : "current-password"}
              placeholder="Password"
              className="h-12 w-full rounded-lg border border-line-strong bg-surface px-4 text-sm text-bone placeholder:text-faint focus-visible:border-ember"
            />
            {flow === "signUp" && !error && (
              <p className="mt-1.5 text-xs text-faint">At least 8 characters.</p>
            )}
          </div>

          {error && <p className="text-sm text-ember-deep">{error}</p>}

          {flow === "signIn" && (
            <Link
              href="/forgot-password"
              className="-mt-1 self-end text-xs text-muted transition-colors hover:text-bone"
            >
              Forgot password?
            </Link>
          )}

          <button
            type="submit"
            disabled={pending}
            className="mt-1 inline-flex h-12 items-center justify-center rounded-full bg-ember font-medium text-[#160b04] transition-colors hover:bg-flare disabled:opacity-60"
          >
            {pending
              ? "One moment…"
              : flow === "signUp"
                ? "Create account"
                : "Sign in"}
          </button>
        </form>

        <button
          onClick={() => {
            setFlow(flow === "signUp" ? "signIn" : "signUp");
            setError(null);
          }}
          className="mt-6 text-sm text-muted transition-colors hover:text-bone"
        >
          {flow === "signUp"
            ? "Already have an account? Sign in"
            : "New here? Create an account"}
        </button>
      </div>
    </div>
  );
}
