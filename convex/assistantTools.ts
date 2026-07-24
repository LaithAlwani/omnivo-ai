import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { randomHex } from "./lib/keys";

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
  daysAhead: v.optional(v.number()),
  startMs: v.optional(v.number()),
  customerName: v.optional(v.string()),
  customerEmail: v.optional(v.string()),
  customerPhone: v.optional(v.string()),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  message: v.optional(v.string()),
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
    name: v.string(),
    input: toolInput,
  },
  returns: v.object({ result: v.string() }),
  handler: async (ctx, args): Promise<{ result: string }> => {
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
    const staff = await ctx.runQuery(internal.staff.listBookableForBusiness, {
      businessId: args.businessId,
    });
    const i = args.input;
    const findService = (n?: string) =>
      n ? services.find((s) => s.name.toLowerCase() === n.toLowerCase()) ?? null : null;
    const findStaff = (n?: string) =>
      n ? staff.find((s) => s.name.toLowerCase() === n.toLowerCase()) ?? null : null;

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
        let serviceId: Id<"services"> | undefined;
        if (i.serviceName) {
          const svc = findService(i.serviceName);
          if (!svc) {
            return result(
              `I couldn't find a service called "${i.serviceName}". We offer: ${services.map((s) => s.name).join(", ") || "nothing yet"}.`,
            );
          }
          serviceId = svc._id;
        }
        let staffId: Id<"staff"> | "any" = "any";
        if (i.staffName) {
          const st = findStaff(i.staffName);
          if (!st) return result(`I couldn't find anyone named "${i.staffName}".`);
          if (st.externalBookingUrl) {
            return result(
              `${st.name} books through their own link: ${st.externalBookingUrl}`,
            );
          }
          staffId = st._id;
        }
        const days = Math.max(1, Math.min(i.daysAhead ?? 14, 30));
        const slots = await ctx.runQuery(internal.slots.getSlotsForBusiness, {
          businessId: args.businessId,
          staffId,
          fromMs: args.nowMs,
          days,
          serviceId,
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
        const svc = findService(i.serviceName);
        if (i.serviceName && !svc) {
          return result(`I couldn't find a service called "${i.serviceName}".`);
        }
        const st = findStaff(i.staffName);
        if (i.staffName && !st) {
          return result(`I couldn't find anyone named "${i.staffName}".`);
        }
        try {
          const res = await ctx.runMutation(internal.bookings.createForBusiness, {
            businessId: args.businessId,
            staffId: st ? st._id : "any",
            start: i.startMs,
            serviceId: svc?._id,
            source: "assistant",
            cancelToken: randomHex(16),
            customerName: i.customerName,
            customerEmail: i.customerEmail,
            customerPhone: i.customerPhone,
          });
          const who = staff.find((s) => s._id === res.staffId)?.name ?? "our team";
          return result(
            `Booked ✅ ${fmt(res.start)} with ${who}. A confirmation will go to ${i.customerEmail}.`,
          );
        } catch (e) {
          return result(`Couldn't book that: ${errMessage(e)}`);
        }
      }

      case "capture_lead": {
        if (!i.name) return result("I need at least a name to pass along.");
        await ctx.runMutation(internal.leads.captureForBusiness, {
          businessId: args.businessId,
          source: "assistant",
          name: i.name,
          email: i.email,
          phone: i.phone,
          message: i.message,
        });
        return result("Got it — I've passed your details to the team.");
      }

      default:
        return result(`Unknown tool: ${args.name}`);
    }
  },
});
