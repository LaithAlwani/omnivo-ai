import type { Metadata } from "next";
import { LegalDoc } from "@/components/layout/legal-doc";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms that govern your use of Omnivo AI — accounts, acceptable use, billing, and liability.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalDoc title="Terms of Service" updated="July 27, 2026">
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of
        Omnivo AI (the &ldquo;Service&rdquo;), operated by Omnivo AI (&ldquo;we&rdquo;,
        &ldquo;us&rdquo;, or &ldquo;our&rdquo;). By creating an account, installing the
        widget, or otherwise using the Service, you agree to be bound by these Terms. If
        you do not agree, do not use the Service.
      </p>

      <h2>1. The Service</h2>
      <p>
        Omnivo AI provides an AI assistant that can be embedded on your website to answer
        visitor questions, book appointments, and capture leads. We may update, improve,
        or change features of the Service at any time. We may also suspend or discontinue
        any part of the Service with reasonable notice where practicable.
      </p>

      <h2>2. Accounts</h2>
      <p>
        You must provide accurate information when you register and keep it up to date.
        You are responsible for safeguarding your account credentials and for all activity
        that occurs under your account. Notify us immediately if you suspect unauthorized
        use. You must be at least 18 years old, or the age of majority in your
        jurisdiction, to use the Service.
      </p>

      <h2>3. Acceptable use</h2>
      <p>You agree not to, and not to permit anyone to:</p>
      <ul>
        <li>use the Service in violation of any applicable law or regulation;</li>
        <li>
          deploy the assistant to deceive, harass, or harm others, or to generate
          unlawful, infringing, or misleading content;
        </li>
        <li>
          attempt to reverse engineer, resell, or circumvent usage limits of the Service
          except as expressly permitted;
        </li>
        <li>
          upload knowledge or content you do not have the right to use, or that infringes
          the rights of any third party;
        </li>
        <li>
          interfere with or disrupt the integrity or performance of the Service or the
          infrastructure it runs on.
        </li>
      </ul>

      <h2>4. Your content and knowledge</h2>
      <p>
        You retain ownership of the business information, knowledge, and other content you
        provide (&ldquo;Your Content&rdquo;). You grant us a limited license to host,
        process, and display Your Content solely to operate and improve the Service for
        you. You are responsible for the accuracy of Your Content and for the responses the
        assistant generates from it.
      </p>

      <h2>5. Fees and billing</h2>
      <p>
        Paid plans are billed in advance on a recurring basis according to the plan you
        select. Fees are non-refundable except where required by law. We may change pricing
        with reasonable advance notice; changes take effect at the start of your next
        billing cycle. You are responsible for any taxes associated with your use of the
        Service.
      </p>

      <h2>6. Third-party services</h2>
      <p>
        The Service integrates with third-party tools such as Google Calendar and email
        and SMS providers. Your use of those integrations is subject to the respective
        third party&rsquo;s terms, and we are not responsible for their services.
      </p>

      <h2>7. Intellectual property</h2>
      <p>
        The Service, including its software, design, and branding, is owned by us and
        protected by intellectual property laws. Except for the rights expressly granted
        here, these Terms do not transfer any of our rights to you.
      </p>

      <h2>8. Termination</h2>
      <p>
        You may stop using the Service and cancel your account at any time. We may suspend
        or terminate your access if you breach these Terms or if required to protect the
        Service or other users. On termination, your right to use the Service ends and we
        may delete Your Content after a reasonable period.
      </p>

      <h2>9. Disclaimers</h2>
      <p>
        The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without
        warranties of any kind, whether express or implied. AI-generated responses may be
        inaccurate or incomplete; you are responsible for reviewing outputs before relying
        on them. We do not warrant that the Service will be uninterrupted or error-free.
      </p>

      <h2>10. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, we will not be liable for any indirect,
        incidental, special, consequential, or punitive damages, or for lost profits or
        revenues. Our total liability for any claim arising out of or relating to the
        Service will not exceed the amount you paid us in the twelve months preceding the
        event giving rise to the claim.
      </p>

      <h2>11. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. If we make material changes, we will
        provide notice through the Service or by email. Your continued use after the
        changes take effect constitutes acceptance of the revised Terms.
      </p>

      <h2>12. Governing law</h2>
      <p>
        These Terms are governed by the laws of the Province of Ontario and the federal
        laws of Canada applicable therein, without regard to conflict-of-law principles.
      </p>

      <h2>13. Contact</h2>
      <p>
        Questions about these Terms? Reach us at{" "}
        <a href="mailto:legal@omnivoai.ca">legal@omnivoai.ca</a>.
      </p>
    </LegalDoc>
  );
}
