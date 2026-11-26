import type { Metadata } from "next";
import { Lato } from "next/font/google";
import "./globals.css";

// Brand guide ("Brand Typography"): Astoria is the main brand font for web,
// but it's a licensed Adobe Fonts/Typekit font gated to the brand's own
// registered domains - not something this app can legitimately embed.
// Lato is the guide's own documented fallback for exactly this situation
// ("Google Suite fallback... where Astoria is unavailable") and is freely
// licensed (SIL OFL), so it's the right choice for an internal tool like
// this one rather than Astoria.
const lato = Lato({
  variable: "--font-lato",
  subsets: ["latin"],
  weight: ["300", "400", "700", "900"],
});

export const metadata: Metadata = {
  title: "Weekly Planner",
  description: "A realistic weekly plan from Asana, Google Calendar and your to-do list.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${lato.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-raven text-chalk">{children}</body>
    </html>
  );
}
