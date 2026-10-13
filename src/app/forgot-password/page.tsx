import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata = { title: "Reset password — Lightsquare" };

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col items-center gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      <ForgotPasswordForm />
    </main>
  );
}
