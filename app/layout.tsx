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
    default: "Omnivo AI — the AI layer that drives the tools you already run",
    template: "%s · Omnivo AI",
  },
  description:
    "An AI assistant that answers, books, and captures leads by driving your existing booking, CRM, and calendar. We install and connect it for you.",
  applicationName: "Omnivo AI",
  keywords: [
    "AI assistant",
    "AI integration layer",
    "AI chatbot for business",
    "lead capture",
    "appointment booking AI",
    "CRM AI assistant",
    "AI receptionist",
  ],
  authors: [{ name: "Omnivo AI" }],
  creator: "Omnivo AI",
  publisher: "Omnivo AI",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Omnivo AI — the AI layer that drives the tools you already run",
    description:
      "An AI assistant that answers, books, and captures leads by driving your existing booking, CRM, and calendar. We install and connect it for you.",
    url: "/",
    type: "website",
    siteName: "Omnivo AI",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Omnivo AI — the AI layer that drives the tools you already run",
    description:
      "An AI assistant that answers, books, and captures leads by driving your existing booking, CRM, and calendar. We install and connect it for you.",
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
