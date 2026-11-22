import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dong Gas Shift Management",
  applicationName: "Dong Gas",
  description: "Secure gas station shift and cash audit",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Dong Gas", statusBarStyle: "default" },
  icons: { icon: "/icon", apple: "/apple-icon" },
};

export const viewport: Viewport = {
  themeColor: "#071525",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-white antialiased">{children}</body>
    </html>
  );
}
