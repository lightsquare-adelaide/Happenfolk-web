import { AuthShell } from "@/components/auth-shell";
import { BRAND } from "@/lib/brand";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata = { title: `Reset password · ${BRAND.name}` };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      pageKey="forgot-password"
      title="Reset password"
      subtitle="We email you a link that lets you choose a new password once."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
