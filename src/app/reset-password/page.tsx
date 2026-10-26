import { AuthShell } from "@/components/auth-shell";
import { BRAND } from "@/lib/brand";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata = { title: `Set a new password · ${BRAND.name}` };

export default function ResetPasswordPage() {
  return (
    <AuthShell
      pageKey="reset-password"
      title="Set a new password"
      subtitle="Choose the password you will use from now on."
    >
      <ResetPasswordForm />
    </AuthShell>
  );
}
