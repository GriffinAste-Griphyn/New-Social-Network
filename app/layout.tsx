import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.ubeye.ai"),
  title: "UBEYE | The post-work income platform",
  description: "UBEYE | The post-work income platform",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "UBEYE | The post-work income platform",
    description: "UBEYE | The post-work income platform",
    url: "/",
    siteName: "UBEYE",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "UBEYE | The post-work income platform",
    description: "UBEYE | The post-work income platform",
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
      className={`${inter.className} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
