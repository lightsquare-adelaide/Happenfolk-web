import { safeNextPath } from "@/lib/safe-next-path";
import { RegisterForm } from "./register-form";

export const metadata = { title: "Sign up — Lightsquare" };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const nextPath = safeNextPath((await searchParams).next);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col items-center gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold">Sign up for Lightsquare</h1>
      <RegisterForm nextPath={nextPath} />
    </main>
  );
}
