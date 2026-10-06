const assert = require("node:assert/strict");
const base = process.env.PRELUDE_TEST_API || "http://localhost:3000";
(async () => {
  const checks = [
    ["/api/client-config", { method: "GET" }, 200],
    ["/api/places?q=Lagos", { method: "GET" }, 401],
    ["/api/holidays?country=NG&year=2026", { method: "GET" }, 401],
    ["/api/notifications/dispatch", { method: "GET" }, 401],
    [
      "/api/auth/signup",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "test@example.com",
          password: "example-password",
          name: "Test",
          nickname: "Test",
        }),
      },
      400,
    ],
    [
      "/api/email/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "test@example.com", code: "bad-code" }),
      },
      400,
    ],
    [
      "/api/email/send",
      {
        method: "OPTIONS",
        headers: { Origin: base, "Access-Control-Request-Method": "POST" },
      },
      204,
    ],
    [
      "/api/email/send",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://untrusted.example",
          "Access-Control-Request-Method": "POST",
        },
      },
      403,
    ],
  ];
  for (const [route, options, status] of checks) {
    const response = await fetch(base + route, options);
    assert.equal(response.status, status, route);
    if (route === "/api/client-config")
      assert.deepEqual(Object.keys(await response.json()), ["vapidPublicKey"]);
    console.log(`PASS ${options.method} ${route}: ${status}`);
  }
  console.log(
    `${checks.length} API smoke checks passed; no emails, accounts or notifications were created.`,
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
