import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createUser, fetchRecoveryToken, stackConfig } from "./_harness";

describe("P2 — password reset, end to end through Mailpit", () => {
  it("email link token leads to a working new password and a dead old one", async () => {
    const user = await createUser("reset");
    const oldPassword = user.password;
    const newPassword = `rotated-${oldPassword}`;

    // 1. Request the reset email.
    const request = await user.client.auth.resetPasswordForEmail(user.email, {
      redirectTo: "http://localhost:3000/reset-password",
    });
    expect(request.error).toBeNull();

    // 2. The mail actually arrived; pull the token GoTrue embedded.
    const tokenHash = await fetchRecoveryToken(user.email);

    // 3. Exchange the token for a recovery session and set a new
    //    password — the programmatic equivalent of clicking the link
    //    and submitting the form.
    const verify = await user.client.auth.verifyOtp({
      type: "recovery",
      token_hash: tokenHash,
    });
    expect(verify.error).toBeNull();
    const update = await user.client.auth.updateUser({ password: newPassword });
    expect(update.error).toBeNull();

    // 4. Fresh client: old password rejected, new password accepted.
    const { url, anonKey } = stackConfig();
    const clean = createClient(url, anonKey, { auth: { persistSession: false } });
    const oldLogin = await clean.auth.signInWithPassword({
      email: user.email,
      password: oldPassword,
    });
    expect(oldLogin.error).toBeTruthy();
    const newLogin = await clean.auth.signInWithPassword({
      email: user.email,
      password: newPassword,
    });
    expect(newLogin.error).toBeNull();
  });
});
