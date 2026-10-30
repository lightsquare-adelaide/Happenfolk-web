import { AuthShell } from "@/components/auth-shell";
import { BRAND } from "@/lib/brand";
import { safeNextPath } from "@/lib/safe-next-path";
import { RegisterForm } from "./register-form";

export const metadata = { title: `Create account · ${BRAND.name}` };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const nextPath = safeNextPath((await searchParams).next);

  return (
    <AuthShell
      pageKey="register"
      title="Create account"
      subtitle="One account for your public profile, your portfolio and the events you organise."
    >
      <RegisterForm nextPath={nextPath} />
    </AuthShell>
  );
}
