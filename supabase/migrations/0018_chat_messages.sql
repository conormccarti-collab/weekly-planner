-- v4 Stage 2, brief section 5.4: "Week-long conversation: keep the chat for
-- the current week so it can be scrolled back. Reset it when the week is
-- accepted or the user clears it." This table was in the original brief's
-- data model (section 4) but was never actually created — the floating
-- chat on other screens stays in-memory-only and untouched by this.

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  week_start date not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_user_week_idx on public.chat_messages (user_id, week_start, created_at);

alter table public.chat_messages enable row level security;

create policy "chat_messages: owner all" on public.chat_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
