import { SignInButton } from "./sign-in-button";

const ERROR_MESSAGES: Record<string, string> = {
  not_allowed: "That Google account isn't allowed to use this app.",
  missing_code: "Sign-in was interrupted. Please try again.",
  exchange_failed: "Sign-in failed. Please try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = error ? ERROR_MESSAGES[error] ?? "Something went wrong." : null;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-raven px-4">
      <div className="text-center">
        <h1 className="text-xl font-semibold text-chalk">Weekly Planner</h1>
        <p className="mt-1 text-sm text-chalk-dim">Sign in with your work Google account.</p>
      </div>
      {message && (
        <p className="rounded-md border border-danger bg-danger-tint px-3 py-2 text-sm text-chalk">{message}</p>
      )}
      <SignInButton />
    </div>
  );
}
