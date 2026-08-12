import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { toolAllowed, type Capability } from "./modules/registry";
import {
  resolveBookingProvider,
  getAvailability,
  createBooking,
  captureLead,
  lookupCustomer,
} from "./lib/providers";

// -----------------------------------------------------------------------------
// The assistant's booking/lead tool executor. The Node chat loop (publicChat.ts)
// hands each tool_use here; this runs in the default runtime so it can be tested
// directly (without the Anthropic round-trip). Every tool funnels into the same
// tenant-scoped internal functions the widget uses, so rules stay identical.
// Results are returned as short natural-language strings for the model to relay.
// -----------------------------------------------------------------------------

export const TOOL_NAMES = [
  "list_services",
  "check_availability",
  "book_appointment",
  "capture_lead",
] as const;

const toolInput = v.object({
  serviceName: v.optional(v.string()),
  staffName: v.optional(v.string()),
  locationName: v.optional(v.string()),
  daysAhead: v.optional(v.number()),
  startMs: v.optional(v.number()),
  customerName: v.optional(v.string()),
  customerEmail: v.optional(v.string()),
  customerPhone: v.optional(v.string()),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  message: v.optional(v.string()),
  // request_contact's optional note on why details are being collected.
  reason: v.optional(v.string()),
});

function errMessage(e: unknown): string {
  if (e instanceof ConvexError) {
    const data = e.data as { message?: string };
    return data?.message ?? "That didn't work.";
  }
  return "Something went wrong.";
}

export const execute = internalAction({
  args: {
    businessId: v.id("businesses"),
    timezone: v.optional(v.string()),
    nowMs: v.number(),
    // The capabilities the enabled modules granted (from the orchestrator). Used
    // to re-check that a requested tool is actually permitted — defense in depth
    // in case the model calls a tool it wasn't offered.
    capabilities: v.array(v.string()),
    name: v.string(),
    input: toolInput,
  },
  returns: v.object({ result: v.string() }),
  handler: async (ctx, args): Promise<{ result: string }> => {
    const caps = new Set(args.capabilities as Capability[]);
    if (!toolAllowed(args.name, caps)) {
      return { result: `That isn't something I can do here.` };
    }

    const tz = args.timezone ?? "UTC";
    const fmt = (ms: number) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(ms));

    const services = await ctx.runQuery(internal.services.listForBusiness, {
      businessId: args.businessId,
    });
    const locations = await ctx.runQuery(
      internal.locations.listActiveForBusiness,
      { businessId: args.businessId },
    );
    const i = args.input;
    const findService = (n?: string) =>
      n ? services.find((s) => s.name.toLowerCase() === n.toLowerCase()) ?? null : null;
    const findLocation = (n?: string) =>
      n
        ? locations.find((l) => l.name.toLowerCase() === n.toLowerCase()) ?? null
        : null;

    const result = (result: string) => ({ result });

    switch (args.name) {
      case "list_services": {
        if (services.length === 0) return result("No services are listed yet.");
        return result(
          services
            .map((s) => {
              const price =
                s.priceCents != null ? ` — $${(s.priceCents / 100).toFixed(2)}` : "";
              return `- ${s.name} (${s.durationMinutes} min${price})`;
            })
            .join("\n"),
        );
      }

      case "check_availability": {
        if (i.serviceName && !findService(i.serviceName)) {
          return result(
            `I couldn't find a service called "${i.serviceName}". We offer: ${services.map((s) => s.name).join(", ") || "nothing yet"}.`,
          );
        }
        if (i.locationName && !findLocation(i.locationName)) {
          return result(
            `I couldn't find a location called "${i.locationName}". We have: ${locations.map((l) => l.name).join(", ") || "one location"}.`,
          );
        }
        const days = Math.max(1, Math.min(i.daysAhead ?? 14, 30));

        // Read availability through the connected provider (defensive: the tool
        // isn't offered unless one resolves).
        const provider = await resolveBookingProvider(ctx, args.businessId);
        if (!provider) {
          return result("I can't check live availability right now.");
        }
        const slots = await getAvailability(ctx, args.businessId, provider, {
          fromMs: args.nowMs,
          days,
          serviceName: i.serviceName,
          locationName: i.locationName,
        });
        if (slots.length === 0) {
          return result(`No open times in the next ${days} days.`);
        }
        const lines = slots
          .slice(0, 12)
          .map((s) => `- ${fmt(s.start)} [startMs:${s.start}]`);
        return result(
          `Open times (use the startMs value to book):\n${lines.join("\n")}`,
        );
      }

      case "book_appointment": {
        if (i.startMs == null || !i.customerName || !i.customerEmail) {
          return result(
            "To book I need: the chosen time (startMs from availability), the customer's name, and their email.",
          );
        }
        if (i.serviceName && !findService(i.serviceName)) {
          return result(`I couldn't find a service called "${i.serviceName}".`);
        }
        if (i.locationName && !findLocation(i.locationName)) {
          return result(`I couldn't find a location called "${i.locationName}".`);
        }

        // Place the booking through the connected provider.
        const provider = await resolveBookingProvider(ctx, args.businessId);
        if (!provider || !provider.caps.has("write")) {
          // No writable booking provider — hand off to the team instead.
          await captureLead(ctx, args.businessId, {
            name: i.customerName,
            email: i.customerEmail,
            phone: i.customerPhone,
            message: `Wants to book ${fmt(i.startMs)}${i.serviceName ? ` for ${i.serviceName}` : ""}.`,
          });
          return result(
            "I can't place the booking myself, but I've passed your details and preferred time to the team — they'll confirm shortly.",
          );
        }
        try {
          const res = await createBooking(ctx, args.businessId, provider, {
            startMs: i.startMs,
            serviceName: i.serviceName,
            staffName: i.staffName,
            locationName: i.locationName,
            customerName: i.customerName,
            customerEmail: i.customerEmail,
            customerPhone: i.customerPhone,
          });
          if (!res.ok) {
            return result(
              "I couldn't complete that booking in the scheduling system — please try another time.",
            );
          }
          return result(
            `Booked ✅ ${fmt(res.start)}. A confirmation will go to ${i.customerEmail}.`,
          );
        } catch (e) {
          return result(`Couldn't book that: ${errMessage(e)}`);
        }
      }

      case "capture_lead": {
        if (!i.name) return result("I need at least a name to pass along.");
        await captureLead(ctx, args.businessId, {
          name: i.name,
          email: i.email,
          phone: i.phone,
          message: i.message,
        });
        return result("Got it — I've passed your details to the team.");
      }

      case "request_contact": {
        // The widget renders the actual form when publicChat reports the tool
        // fired; here we just acknowledge so the model wraps up in one line.
        return result(
          "A short contact form is now shown to the visitor — invite them to fill it in with one brief line.",
        );
      }

      case "lookup_customer": {
        if (!i.email && !i.phone) {
          return result("Give me an email or phone number to look them up.");
        }
        const profile = await lookupCustomer(ctx, args.businessId, {
          email: i.email,
          phone: i.phone,
        });
        return result(
          profile
            ? `Customer record: ${profile}`
            : "I couldn't find a matching customer record.",
        );
      }

      default:
        return result(`Unknown tool: ${args.name}`);
    }
  },
});
