import { Nav } from "@/components/nav";
import { ChatButton } from "@/components/chat-button";
import { createClient } from "@/lib/supabase/server";
import { loadSettings } from "@/lib/settings-data";
import { officeAccentFor } from "@/lib/brand-colors";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  const office = user ? (await loadSettings(supabase, user.id)).office : null;
  const accent = officeAccentFor(office);

  return (
    <div
      className="flex min-h-screen flex-1 flex-col"
      style={accent ? ({ "--color-accent": accent.accent, "--color-on-accent": accent.onAccent } as React.CSSProperties) : undefined}
    >
      <Nav />
      <main className="flex-1 px-6 py-6">{children}</main>
      <ChatButton />
    </div>
  );
}
