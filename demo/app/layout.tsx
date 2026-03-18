import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "agent-insurance — Performance Bond Insurance for ERC-8183",
  description: "Provider defaults. Client gets paid. Automatically. Parametric performance bond insurance for ERC-8183 AI agent job markets on Base.",
  openGraph: {
    title: "agent-insurance",
    description: "Performance Bond Insurance for ERC-8183 AI Agent Job Markets",
    url: "https://oxyuns.github.io/agent-insurance-demo",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
