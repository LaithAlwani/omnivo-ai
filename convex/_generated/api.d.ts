/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as analytics from "../analytics.js";
import type * as assistant from "../assistant.js";
import type * as assistantContext from "../assistantContext.js";
import type * as assistantTools from "../assistantTools.js";
import type * as auth from "../auth.js";
import type * as availability from "../availability.js";
import type * as blackouts from "../blackouts.js";
import type * as bookings from "../bookings.js";
import type * as businesses from "../businesses.js";
import type * as calendar from "../calendar.js";
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as emailDomains from "../emailDomains.js";
import type * as emailNode from "../emailNode.js";
import type * as embedKeys from "../embedKeys.js";
import type * as entitlements from "../entitlements.js";
import type * as http from "../http.js";
import type * as integrations from "../integrations.js";
import type * as integrationsNode from "../integrationsNode.js";
import type * as knowledge from "../knowledge.js";
import type * as leads from "../leads.js";
import type * as lib_accounts from "../lib/accounts.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_bookingProviders from "../lib/bookingProviders.js";
import type * as lib_bookingRules from "../lib/bookingRules.js";
import type * as lib_calendarProviders from "../lib/calendarProviders.js";
import type * as lib_calendarState from "../lib/calendarState.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_keys from "../lib/keys.js";
import type * as lib_leoPrompt from "../lib/leoPrompt.js";
import type * as lib_resend from "../lib/resend.js";
import type * as lib_secretsNode from "../lib/secretsNode.js";
import type * as lib_slots from "../lib/slots.js";
import type * as lib_tiers from "../lib/tiers.js";
import type * as locations from "../locations.js";
import type * as modules_registry from "../modules/registry.js";
import type * as passwordReset from "../passwordReset.js";
import type * as platform from "../platform.js";
import type * as public_ from "../public.js";
import type * as publicChat from "../publicChat.js";
import type * as rateLimiter from "../rateLimiter.js";
import type * as resend from "../resend.js";
import type * as reviews from "../reviews.js";
import type * as sales from "../sales.js";
import type * as services from "../services.js";
import type * as slots from "../slots.js";
import type * as sms from "../sms.js";
import type * as staff from "../staff.js";
import type * as team from "../team.js";
import type * as tiers from "../tiers.js";
import type * as usage from "../usage.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  analytics: typeof analytics;
  assistant: typeof assistant;
  assistantContext: typeof assistantContext;
  assistantTools: typeof assistantTools;
  auth: typeof auth;
  availability: typeof availability;
  blackouts: typeof blackouts;
  bookings: typeof bookings;
  businesses: typeof businesses;
  calendar: typeof calendar;
  conversations: typeof conversations;
  crons: typeof crons;
  emailDomains: typeof emailDomains;
  emailNode: typeof emailNode;
  embedKeys: typeof embedKeys;
  entitlements: typeof entitlements;
  http: typeof http;
  integrations: typeof integrations;
  integrationsNode: typeof integrationsNode;
  knowledge: typeof knowledge;
  leads: typeof leads;
  "lib/accounts": typeof lib_accounts;
  "lib/authz": typeof lib_authz;
  "lib/bookingProviders": typeof lib_bookingProviders;
  "lib/bookingRules": typeof lib_bookingRules;
  "lib/calendarProviders": typeof lib_calendarProviders;
  "lib/calendarState": typeof lib_calendarState;
  "lib/errors": typeof lib_errors;
  "lib/keys": typeof lib_keys;
  "lib/leoPrompt": typeof lib_leoPrompt;
  "lib/resend": typeof lib_resend;
  "lib/secretsNode": typeof lib_secretsNode;
  "lib/slots": typeof lib_slots;
  "lib/tiers": typeof lib_tiers;
  locations: typeof locations;
  "modules/registry": typeof modules_registry;
  passwordReset: typeof passwordReset;
  platform: typeof platform;
  public: typeof public_;
  publicChat: typeof publicChat;
  rateLimiter: typeof rateLimiter;
  resend: typeof resend;
  reviews: typeof reviews;
  sales: typeof sales;
  services: typeof services;
  slots: typeof slots;
  sms: typeof sms;
  staff: typeof staff;
  team: typeof team;
  tiers: typeof tiers;
  usage: typeof usage;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
