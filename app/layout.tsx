import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import Nav from "./components/Nav";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });

export const metadata: Metadata = {
  title: "Calisthenics — Build your plan",
  description: "AI-powered personalized calisthenics workout generator",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Calisthenics" },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Unregister any stale service workers left from next-pwa */}
        <script dangerouslySetInnerHTML={{ __html: `
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(function(regs) {
              regs.forEach(function(reg) { reg.unregister(); });
            });
          }
        ` }} />
      </head>
      <body className="min-h-full flex flex-col bg-background">
        <Nav />
        <div className="flex-1">
          {children}
        </div>
      </body>
    </html>
  );
}
