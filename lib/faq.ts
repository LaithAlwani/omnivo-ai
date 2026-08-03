import type { Faq } from "@/lib/types";

export const faqs: Faq[] = [
  {
    q: "How does the assistant know about my business?",
    a: "You fill in a short knowledge base — services, hours, pricing, policies, common questions. The assistant answers only from that, so it quotes your real prices and never makes things up. You can edit it any time and the answers update instantly.",
  },
  {
    q: "What do I actually have to install?",
    a: "One line of HTML — a single <script> tag you paste before the closing body tag. It works on any site: WordPress, Squarespace, Shopify, Webflow, or hand-coded. No plugins, no developers.",
  },
  {
    q: "Can it really book appointments?",
    a: "Yes. Connect your Google Calendar and the assistant checks live availability, offers real open slots, and books the appointment inside the conversation. The customer gets a confirmation; you get the event on your calendar.",
  },
  {
    q: "What happens to the leads it captures?",
    a: "Every enquiry becomes a tracked lead with the contact's details, what they asked, and where they came from. You see them in your dashboard and can follow up by email or SMS — automatically or by hand.",
  },
  {
    q: "Will it look like my brand or like Omnivo AI?",
    a: "Yours. On Professional and up you set the logo, colors, and assistant name, and remove our branding entirely. Customers see your assistant on your site — they never know we exist.",
  },
  {
    q: "Is my customers' data safe?",
    a: "The widget only runs on domains you approve, keys are stored hashed and can be rotated instantly, and each business's data is fully isolated. Conversations stay tied to your account.",
  },
  {
    q: "What if the assistant can't answer something?",
    a: "It's built to know its limits. When a question is out of scope it captures the lead and offers to have a human follow up, rather than guessing. You stay in control of the handoff.",
  },
  {
    q: "How much does it cost?",
    a: "You hire one AI employee on a bundled tier. Starter is $299/mo (Booking + Lead Capture + SMS, 1 location, $15 AI credits, 2,500 emails, 100 SMS). Professional is $449/mo (adds Review Management + higher limits, 2 locations, $30 AI credits, 500 SMS). Premium is $499/mo (adds Sales Assistant + Integrations + white-label + custom domain, 5 locations, $50 AI credits, 15,000 emails, 1,500 SMS). AI credits are a monthly balance spent by the tokens your assistant uses to chat — heavier months cost more, and you can top up with a $10 = 1M-token pack or let usage run at $3 per 100K tokens over. Extra locations are $19.99/mo each, and Enterprise is custom. The first 10 customers get Founding Partner Pricing — 50% off, locked in. Every plan starts with a free trial.",
  },
];
