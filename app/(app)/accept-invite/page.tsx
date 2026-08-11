"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAction, useConvexAuth } from "convex/react";
import { api } from "@/convex/_generated/api";
import { errorText } from "@/lib/errors";

function AcceptInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const router = useRouter();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const accept = useAction(api.invitations.accept);
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || isLoading || !isAuthenticated || state !== "idle") return;
    setState("working");
    accept({ token })
      .then(({ slug }) => router.replace(`/dashboard/${slug}`))
      .catch((e) => {
        setError(errorText(e));
        setState("error");
      });
  }, [token, isAuthenticated, isLoading, state, accept, router]);

  const nextUrl = `/accept-invite?token=${encodeURIComponent(token)}`;

  return (
    <div className="mx-auto mt-24 max-w-md px-6 text-center">
      <h1 className="font-display text-2xl text-bone">Accept your invitation</h1>
      {!token && (
        <p className="mt-3 text-sm text-muted">This invite link is missing its token.</p>
      )}
      {token && !isLoading && !isAuthenticated && (
        <>
          <p className="mt-3 text-sm text-muted">
            Sign in (or create your account) with the invited email to accept.
          </p>
          <Link
            href={`/signin?next=${encodeURIComponent(nextUrl)}`}
            className="mt-5 inline-block h-10 rounded-full bg-ember px-5 text-sm font-medium leading-10 text-[#160b04] transition-colors hover:bg-flare"
          >
            Sign in to accept
          </Link>
        </>
      )}
      {token && isAuthenticated && state === "working" && (
        <p className="mt-3 text-sm text-muted">Accepting…</p>
      )}
      {state === "error" && (
        <p className="mt-3 text-sm text-ember-deep">{error}</p>
      )}
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInner />
    </Suspense>
  );
}
