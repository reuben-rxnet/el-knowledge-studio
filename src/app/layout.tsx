import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "EL Knowledge Studio", template: "%s · EL Knowledge Studio" },
  description: "Capture once. Share knowledge everywhere. Transform business processes into videos, guides, training content and searchable knowledge with enterprise AI.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
