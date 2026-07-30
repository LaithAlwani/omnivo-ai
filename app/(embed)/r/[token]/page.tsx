"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

// Public review-response page. A completed-booking customer lands here from an
// SMS/email link. Positive → sent to the business's public review page; negative
// → we capture private feedback for the team.
export default function ReviewResponsePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const data = useQuery(api.reviews.getByToken, { token });
  const respond = useMutation(api.reviews.respond);

  const [step, setStep] = useState<"ask" | "negative" | "done">("ask");
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewLink, setReviewLink] = useState<string | null>(null);

  // If they already responded, jump straight to the closing state.
  useEffect(() => {
    if (data?.status === "responded") setStep("done");
  }, [data?.status]);

  if (data === undefined) {
    return <Shell><p className="text-sm text-faint">Loading…</p></Shell>;
  }
  if (data === null) {
    return (
      <Shell>
        <p className="text-sm text-muted">This review link is no longer valid.</p>
      </Shell>
    );
  }

  async function choose(sentiment: "positive" | "negative", stars?: number) {
    setBusy(true);
    try {
      const { reviewLink } = await respond({
        token,
        sentiment,
        rating: stars,
      });
      if (sentiment === "positive") {
        setReviewLink(reviewLink);
        if (reviewLink) {
          window.location.href = reviewLink;
          return;
        }
        setStep("done");
      } else {
        setStep("negative");
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitFeedback() {
    setBusy(true);
    try {
      await respond({ token, sentiment: "negative", rating: rating || undefined, feedback });
      setStep("done");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <p className="font-mono text-xs uppercase tracking-wider text-ember">
        {data.businessName}
      </p>

      {step === "ask" && (
        <>
          <h1 className="mt-2 font-display text-2xl text-bone">
            How was your visit?
          </h1>
          <div className="mt-5 flex justify-center gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                disabled={busy}
                onMouseEnter={() => setRating(n)}
                onClick={() => choose(n >= 4 ? "positive" : "negative", n)}
                className={`text-3xl transition-colors ${
                  n <= rating ? "text-ember" : "text-line-strong"
                }`}
                aria-label={`${n} star${n > 1 ? "s" : ""}`}
              >
                ★
              </button>
            ))}
          </div>
          <p className="mt-4 text-xs text-faint">Tap a rating to continue.</p>
        </>
      )}

      {step === "negative" && (
        <>
          <h1 className="mt-2 font-display text-2xl text-bone">
            Sorry it wasn&rsquo;t perfect
          </h1>
          <p className="mt-2 text-sm text-muted">
            Tell us what happened — it goes straight to the team, privately.
          </p>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={4}
            placeholder="What could we have done better?"
            className="mt-4 w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-bone placeholder:text-faint focus-visible:border-ember"
          />
          <button
            onClick={submitFeedback}
            disabled={busy}
            className="mt-4 h-11 w-full rounded-full bg-ember text-sm font-medium text-[#160b04] transition-colors hover:bg-flare disabled:opacity-60"
          >
            {busy ? "Sending…" : "Send feedback"}
          </button>
        </>
      )}

      {step === "done" && (
        <>
          <h1 className="mt-2 font-display text-2xl text-bone">Thank you!</h1>
          <p className="mt-2 text-sm text-muted">
            We appreciate you taking the time.
          </p>
          {reviewLink && (
            <a
              href={reviewLink}
              className="mt-4 inline-block text-sm text-ember underline hover:text-flare"
            >
              Leave a public review
            </a>
          )}
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface/60 p-8 text-center">
        {children}
      </div>
    </div>
  );
}
