import type { Metadata, Viewport } from "next";
import { Noto_Sans, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";

const sans = Noto_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const deva = Noto_Sans_Devanagari({ subsets: ["devanagari"], variable: "--font-deva", display: "swap" });

export const metadata: Metadata = {
  title: "Apna Babu — the government clerk who works for you",
  description: "A voice-first assistant that fills any paper form in English, Hindi, Marathi or Hinglish. Powered by Sarvam AI.",
  metadataBase: new URL("https://apna-babu.vercel.app"),
  openGraph: {
    title: "Apna Babu",
    description: "Every Indian has paid a tout to fill a form. Apna Babu does it free, in your language.",
    url: "/",
    siteName: "Apna Babu",
    type: "website",
  },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1e3a8a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${deva.variable}`}>{children}</body>
    </html>
  );
}
