import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { getPublicSiteUrl } from "@/lib/site-url";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(getPublicSiteUrl()),
  applicationName: "UBEYE",
  alternates: {
    canonical: "/",
  },
  title: "UBEYE",
  description:
    "A social network and wealth redistribution experiment where people participate in the value their attention creates.",
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    url: "/",
    siteName: "UBEYE",
    title: "UBEYE",
    description:
      "A social network and wealth redistribution experiment where people participate in the value their attention creates.",
  },
  twitter: {
    card: "summary_large_image",
    title: "UBEYE",
    description:
      "A social network and wealth redistribution experiment where people participate in the value their attention creates.",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "UBEYE",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.className} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
