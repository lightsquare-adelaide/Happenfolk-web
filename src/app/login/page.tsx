import { safeNextPath } from "@/lib/safe-next-path";
import { LoginForm } from "./login-form";

export const metadata = { title: "Log in — Lightsquare" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  // Same-origin application paths only. See safeNextPath for why a bare
  // startsWith("/") check is an open redirect.
  const nextPath = safeNextPath(params.next);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col items-center gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold">Log in to Lightsquare</h1>
      <LoginForm nextPath={nextPath} />
    </main>
  );
}
