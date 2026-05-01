import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });

export const metadata: Metadata = {
  title: "Calisthenics — Build your plan",
  description: "AI-powered personalized calisthenics workout generator",
  manifest: "/manifest.json",
  themeColor: "#09090b",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Calisthenics" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-zinc-950">{children}</body>
    </html>
  );
}
