import { createClient } from "@/lib/supabase/server";
import { IdeaRow } from "@/components/idea-row";

export default async function IdeasPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  if (!user) {
    return <h1 className="text-lg font-semibold">Ideas</h1>;
  }

  const { data } = await supabase
    .from("ideas")
    .select("id, title, status, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const ideas = (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    status: row.status as string,
    createdAt: (row.created_at as string).slice(0, 10),
  }));

  const open = ideas.filter((i) => i.status === "open");
  const resolved = ideas.filter((i) => i.status !== "open");

  return (
    <div>
      <h1 className="text-lg font-semibold">Ideas</h1>
      <p className="mt-1 text-sm text-chalk-dim">
        Capture ideas here or via chat (&quot;Idea: ...&quot;). Each one can be turned into a personal task or dropped.
      </p>

      <ul className="mt-4 divide-y divide-border">
        {open.length === 0 && <p className="py-2 text-sm text-chalk-dim">No open ideas.</p>}
        {open.map((idea) => (
          <IdeaRow key={idea.id} idea={idea} />
        ))}
      </ul>

      {resolved.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-medium text-chalk">
            Converted / dropped ({resolved.length})
          </summary>
          <ul className="mt-2 divide-y divide-border">
            {resolved.map((idea) => (
              <IdeaRow key={idea.id} idea={idea} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
