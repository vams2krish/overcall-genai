import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "http://127.0.0.1:3000",
  ),
  title: "Overcall — Make the call. Own the moment.",
  description:
    "Social sports predictions for your inner circle. Virtual tokens, custom props, human-confirmed results.",
  icons: { icon: "/logo.svg" },
  openGraph: {
    title: "Overcall [GenAI]",
    description: "Your friends. Your predictions. Your match room.",
    images: ["/project-cover.svg"],
  },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
