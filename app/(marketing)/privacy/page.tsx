import type { Metadata } from "next";
import { LegalDoc } from "@/components/layout/legal-doc";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Omnivo AI collects, uses, and protects personal information for account holders and the visitors who chat with the assistant.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalDoc title="Privacy Policy" updated="July 27, 2026">
      <p>
        This Privacy Policy explains how Omnivo AI (&ldquo;we&rdquo;, &ldquo;us&rdquo;, or
        &ldquo;our&rdquo;) collects, uses, and shares personal information when you use our
        website, dashboard, and embeddable assistant (the &ldquo;Service&rdquo;). It covers
        both our customers (account holders) and the visitors who interact with an
        assistant powered by Omnivo AI.
      </p>

      <h2>1. Information we collect</h2>
      <ul>
        <li>
          <strong>Account information</strong> — name, email address, and billing details
          you provide when you register or subscribe.
        </li>
        <li>
          <strong>Business knowledge</strong> — the hours, services, pricing, FAQs, and
          other content you add so the assistant can answer on your behalf.
        </li>
        <li>
          <strong>Conversation data</strong> — messages exchanged with the assistant,
          including contact details a visitor chooses to share (such as name, email, or
          phone) and captured leads.
        </li>
        <li>
          <strong>Usage and device data</strong> — log data, IP address, browser type, and
          interactions with the Service, collected to operate and secure it.
        </li>
      </ul>

      <h2>2. How we use information</h2>
      <p>We use personal information to:</p>
      <ul>
        <li>provide, maintain, and improve the Service;</li>
        <li>
          generate assistant responses, book appointments, and capture and route leads;
        </li>
        <li>process payments and manage your subscription;</li>
        <li>send transactional messages such as confirmations, reminders, and follow-ups;</li>
        <li>monitor for abuse, secure the Service, and comply with legal obligations.</li>
      </ul>

      <h2>3. AI processing</h2>
      <p>
        The assistant uses third-party large language model providers to generate
        responses. Conversation content is sent to these providers solely to produce a
        reply. We do not sell personal information, and we do not use your conversation
        data to train third-party foundation models except as needed to deliver the
        Service.
      </p>

      <h2>4. How we share information</h2>
      <p>We share personal information only as needed to run the Service:</p>
      <ul>
        <li>
          <strong>With the account holder</strong> — visitors&rsquo; conversations and
          captured leads are shared with the business operating the assistant.
        </li>
        <li>
          <strong>Service providers</strong> — hosting, AI model, email, SMS, and calendar
          providers that process data on our behalf under appropriate safeguards.
        </li>
        <li>
          <strong>Legal reasons</strong> — where required by law, or to protect the rights,
          safety, and security of Omnivo AI, our users, or the public.
        </li>
        <li>
          <strong>Business transfers</strong> — in connection with a merger, acquisition,
          or sale of assets, subject to this Policy.
        </li>
      </ul>

      <h2>5. Data retention</h2>
      <p>
        We retain personal information for as long as your account is active or as needed
        to provide the Service, then delete or anonymize it within a reasonable period
        unless a longer retention period is required by law. Account holders can request
        deletion of specific conversation or lead data.
      </p>

      <h2>6. Security</h2>
      <p>
        We use technical and organizational measures to protect personal information. The
        assistant runs only on domains you approve, embed keys are stored hashed and can be
        rotated instantly, and each business&rsquo;s data is isolated. No method of
        transmission or storage is completely secure, however, and we cannot guarantee
        absolute security.
      </p>

      <h2>7. Your rights</h2>
      <p>
        Depending on your location, you may have the right to access, correct, delete, or
        port your personal information, or to object to or restrict certain processing. To
        exercise these rights, contact us using the details below. If you interacted with
        an assistant operated by one of our customers, please contact that business
        directly, as they control that data.
      </p>

      <h2>8. International transfers</h2>
      <p>
        We may process and store information in countries other than where you live. Where
        we transfer personal information across borders, we use appropriate safeguards
        consistent with applicable law.
      </p>

      <h2>9. Children&rsquo;s privacy</h2>
      <p>
        The Service is not directed to children under 16, and we do not knowingly collect
        personal information from them. If you believe a child has provided us information,
        contact us and we will delete it.
      </p>

      <h2>10. Changes to this Policy</h2>
      <p>
        We may update this Policy from time to time. If we make material changes, we will
        notify you through the Service or by email. The &ldquo;last updated&rdquo; date at
        the top reflects the latest revision.
      </p>

      <h2>11. Contact</h2>
      <p>
        Questions or requests about your privacy? Reach us at{" "}
        <a href="mailto:privacy@omnivoai.ca">privacy@omnivoai.ca</a>.
      </p>
    </LegalDoc>
  );
}
