import { defineApp } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";

// Mounted Convex components. The rate limiter gives us durable, race-free
// per-tenant quotas on the public widget surface (see rateLimiter.ts).
const app = defineApp();
app.use(rateLimiter);

export default app;
