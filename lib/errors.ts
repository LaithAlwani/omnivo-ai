import { ConvexError } from "convex/values";

// Client-side reader for the structured errors thrown by convex/lib/errors.ts.
// Turns any caught value into a { code, message } the UI can show.

type UserError = { code: string; message: string };

function toUserError(err: unknown): UserError {
  if (err instanceof ConvexError) {
    const data = err.data as unknown;
    if (data && typeof data === "object" && "message" in data) {
      const d = data as { code?: string; message?: string };
      return {
        code: d.code ?? "ERROR",
        message: d.message ?? "Something went wrong.",
      };
    }
    if (typeof data === "string") return { code: "ERROR", message: data };
  }
  if (err instanceof Error && err.message) {
    return { code: "ERROR", message: err.message };
  }
  return { code: "UNKNOWN", message: "Something went wrong. Please try again." };
}

/** One display string: "message (CODE)". */
export function errorText(err: unknown): string {
  const { code, message } = toUserError(err);
  return `${message} (${code})`;
}
