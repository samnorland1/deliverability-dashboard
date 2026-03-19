import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Deliverability Dashboard",
  description: "Klaviyo deliverability monitoring for all client accounts",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
