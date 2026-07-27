import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import "./globals.css";

// Body — clean, neutral, modern.
const geistSans = Geist({
  variable: "--ff-sans",
  subsets: ["latin"],
});

// The "engine/technical" voice — eyebrows, labels, telemetry, code.
const geistMono = Geist_Mono({
  variable: "--ff-mono",
  subsets: ["latin"],
});

// The "editorial luxury" voice — headlines only. High optical contrast + soft axis.
const fraunces = Fraunces({
  variable: "--ff-display",
  subsets: ["latin"],
  axes: ["SOFT", "opsz"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://omnivoai.ca"),
  title: {
    default: "Omni AI — an AI assistant that chats, books, and captures leads",
    template: "%s · Omni AI",
  },
  description:
    "Deploy an AI assistant that chats with visitors, books appointments, and captures leads on your site. Paste one snippet — it goes live in minutes.",
  applicationName: "Omni AI",
  keywords: [
    "AI assistant",
    "AI chatbot for business",
    "lead capture",
    "appointment booking AI",
    "embeddable AI widget",
    "AI receptionist",
  ],
  authors: [{ name: "Omni AI" }],
  creator: "Omni AI",
  publisher: "Omni AI",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Omni AI — an AI assistant that chats, books, and captures leads",
    description:
      "Paste one snippet. An AI assistant that answers, books, and captures leads goes live on your site.",
    url: "/",
    type: "website",
    siteName: "Omni AI",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Omni AI — an AI assistant that chats, books, and captures leads",
    description:
      "Paste one snippet. An AI assistant that answers, books, and captures leads goes live on your site.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full`}
    >
      <body className="min-h-full flex flex-col bg-ink text-bone">{children}</body>
    </html>
  );
}
