import { AuthShell } from "@/components/auth-shell";
import { BRAND } from "@/lib/brand";
import { safeNextPath } from "@/lib/safe-next-path";
import { LoginForm } from "./login-form";

export const metadata = { title: `Log in · ${BRAND.name}` };

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
    <AuthShell
      pageKey="login"
      title="Log in"
      subtitle="Pick up your profile, your portfolio and your events where you left them."
    >
      <LoginForm nextPath={nextPath} />
    </AuthShell>
  );
}
