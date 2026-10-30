// Read-only HTTP and anonymous authorization checks. Never creates an account.
import { runtime, request, assert } from "./http-harness.mjs";
try {
  const { base, publicClient } = runtime();
  for (const page of ["/", "/discover", "/events", "/login", "/register", "/forgot-password", "/about", "/collaborate", "/privacy", "/terms", "/licence", "/credits"]) {
    const r = await request(base, page);
    assert(r.status === 200, `GET ${page}: ${r.status}`);
    assert(!/Something went wrong|Internal Server Error/.test(r.text), `${page} has no error boundary`);
  }
  const dashboard = await request(base, "/dashboard");
  assert([302, 303, 307, 308].includes(dashboard.status) && dashboard.headers.get("location")?.includes("/login"), "anonymous dashboard redirects to login");
  for (const table of ["page_views", "page_views_monthly", "admin_staff"]) {
    const { data, error } = await publicClient.from(table).select("*").limit(1);
    assert(!error && data?.length === 0, `anonymous ${table} read exposes no rows`);
  }
  for (const rpc of ["set_payment_stub_force_fail", "run_page_view_retention"]) {
    const args = rpc === "set_payment_stub_force_fail" ? { p_force_fail: true } : {};
    const { error } = await publicClient.rpc(rpc, args);
    assert(Boolean(error) && ["42501", "PGRST202"].includes(error.code), `anonymous ${rpc} permission denied`);
  }
  console.log(`Smoke passed against ${base}`);
} catch (err) { console.error(err.message); process.exitCode = 1; }
