import type { Faq } from "@/lib/types";

export const faqs: Faq[] = [
  {
    q: "How does the assistant know about my business?",
    a: "You fill in a short knowledge base — services, hours, pricing, policies, common questions. The assistant answers only from that, so it quotes your real prices and never makes things up. You can edit it any time and the answers update instantly.",
  },
  {
    q: "Do I have to replace the tools I already use?",
    a: "No. Omnivo is a layer on top of your existing stack — it connects your booking system, CRM, and calendar and acts through them. Nothing to rip out or migrate. If you don't have a system of record yet, our Managed engine is the built-in fallback. Most businesses have us do the install: we audit what you run, connect it, verify every path, and go live for you.",
  },
  {
    q: "Can it really book appointments?",
    a: "Yes. It books into your own scheduling system when one is connected — checking live availability, offering real open slots, and confirming inside the conversation — or into Omnivo's Managed calendar as a fallback. The customer gets a confirmation; the booking lands wherever you run your schedule.",
  },
  {
    q: "What happens to the leads it captures?",
    a: "Every enquiry becomes a tracked lead with the contact's details, what they asked, and where they came from. You see them in your dashboard, follow up by email, and — when your CRM is connected — the lead is pushed straight into it.",
  },
  {
    q: "Will it look like my brand or like Omnivo AI?",
    a: "Yours. On Premium you set the logo, colors, and assistant name, and remove our branding entirely. Customers see your assistant on your site — they never know we exist.",
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
    a: "Two paths. Set it up yourself on a published monthly plan: Starter $299/mo (Booking + Lead Capture + Connections, 1 location, $15 AI credits), Professional $449/mo (2 locations, $30 AI credits), Premium $499/mo (white-label + custom domain, 5 locations, $50 AI credits). Extra locations are $19.99/mo each. AI credits are a monthly balance spent by the tokens your assistant uses to chat — heavier months cost more, and it's the only usage-based charge. Prefer we install it? We audit your systems, connect them, and go live for you; installed deployments are quoted per project (a setup fee plus monthly). Book an install call for a quote. Enterprise is custom.",
  },
];
