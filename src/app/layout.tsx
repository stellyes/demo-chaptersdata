import type { Metadata, Viewport } from "next";
import { DM_Sans, Cormorant_Garamond } from "next/font/google";
import "./globals.css";
import { DarkModeProvider } from "@/components/providers/DarkModeProvider";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { LoadingOverlayProvider } from "@/components/providers/LoadingOverlayProvider";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Chapters Analytics | Retail Intelligence Dashboard",
  description: "AI-powered analytics dashboard for cannabis retail operations",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Chapters",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: "/icon-512.png",
    apple: "/icon-512.png",
  },
  themeColor: "#1A1A1A",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#1A1A1A",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} ${cormorant.variable} antialiased`}>
        <AuthProvider>
          <DarkModeProvider>
            <LoadingOverlayProvider>{children}</LoadingOverlayProvider>
          </DarkModeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
