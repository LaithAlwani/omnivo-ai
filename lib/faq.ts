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
    a: "You hire one AI employee on a base plan — Starter is $99/mo (1 project, 2,500 conversations and 2,500 emails a month) and Professional is $249/mo (up to 3 projects, higher limits, white-label, and a custom email domain). Then you switch on the skills you need as add-on modules: Booking (+$49), Lead Qualification (+$15), SMS Automation (+$49), Review Management (+$29), Sales Assistant (+$49), and Integrations (+$49). Enterprise is custom. Every plan starts with a free trial.",
  },
];
