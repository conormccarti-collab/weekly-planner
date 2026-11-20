function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  allowedEmail: () => required("ALLOWED_EMAIL").toLowerCase(),
  appTimezone: () => process.env.APP_TIMEZONE || "Europe/London",
  encryptionKey: () => required("ENCRYPTION_KEY"),
  asanaPat: () => required("ASANA_PAT"),
  asanaWorkspaceGid: () => required("ASANA_WORKSPACE_GID"),
  googleOauthClientId: () => required("GOOGLE_OAUTH_CLIENT_ID"),
  googleOauthClientSecret: () => required("GOOGLE_OAUTH_CLIENT_SECRET"),
  anthropicApiKey: () => required("ANTHROPIC_API_KEY"),
  anthropicModel: () => process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
  resendApiKey: () => required("RESEND_API_KEY"),
  cronSecret: () => process.env.CRON_SECRET || null,
};
