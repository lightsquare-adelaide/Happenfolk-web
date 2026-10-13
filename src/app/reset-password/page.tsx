import { ResetPasswordForm } from "./reset-password-form";

export const metadata = { title: "Set a new password — Lightsquare" };

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col items-center gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold">Set a new password</h1>
      <ResetPasswordForm />
    </main>
  );
}
