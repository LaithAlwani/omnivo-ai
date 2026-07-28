import { ConvexError } from "convex/values";

// -----------------------------------------------------------------------------
// Structured, user-readable errors. Thrown as ConvexError so the { code, message }
// payload survives to the client — plain `throw new Error()` is redacted to
// "Server Error" in production. Always throw via appError(...).
// -----------------------------------------------------------------------------

export type AppErrorCode =
  | "UNAUTHENTICATED" // not signed in
  | "FORBIDDEN" // signed in, but not allowed
  | "NOT_FOUND" // target doesn't exist
  | "CONFLICT" // duplicate / invariant violation
  | "INVALID_INPUT" // bad argument the user can fix
  | "INVALID_CREDENTIALS" // wrong password / bad token
  | "RATE_LIMITED" // too many requests — back off and retry
  | "CONFIG"; // server misconfiguration (operator-facing)

export function appError(code: AppErrorCode, message: string): never {
  throw new ConvexError({ code, message });
}
