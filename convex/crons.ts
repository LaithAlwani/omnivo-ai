import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

// -----------------------------------------------------------------------------
// Scheduled fan-out. Jobs are kept small and orchestrated top-down so a single
// tenant's data can never blow a transaction. (Booking reminders + calendar
// free/busy refresh were removed with the native booking engine — booking now
// lives entirely in the client's connected scheduler.)
// -----------------------------------------------------------------------------

const crons = cronJobs();
// Connection health: probe each active booking / inbound-CRM connection; N
// consecutive failures mark it degraded so the agent drops its tools + hands off.
crons.interval("check connection health", { minutes: 15 }, internal.health.enqueueChecks, {});

export default crons;
