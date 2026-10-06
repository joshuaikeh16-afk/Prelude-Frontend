const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(
  path.resolve(__dirname, "../js/config.js"),
  "utf8",
);
function config(hostname, override) {
  const sandbox = {
    window: { PreludeConfig: override },
    location: { hostname, origin: `https://${hostname}`, hash: "", search: "" },
    URLSearchParams,
  };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.PreludeConfig;
}
test("Local HTML hosts use the same hostname for API calls on port 3000", () => {
  for (const hostname of ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"])
    assert.equal(config(hostname).apiBase, `http://${hostname}:3000`);
  assert.equal(config("prelude.example").apiBase, "https://prelude.example");
  assert.equal(
    config("0.0.0.0", { apiBase: "https://api.example" }).apiBase,
    "https://api.example",
  );
});
test("HTML error pages and network failures produce readable errors", async () => {
  const { api } = await import("../js/data.js");
  const priorFetch = global.fetch,
    priorWindow = global.window;
  global.window = { PreludeConfig: { apiBase: "http://localhost:3000" } };
  try {
    let requested;
    global.fetch = async (url) => {
      requested = url;
      return new Response("<html>Unsupported method POST</html>", {
        status: 501,
        headers: { "Content-Type": "text/html" },
      });
    };
    await assert.rejects(
      api("/api/email/send", {
        method: "POST",
        body: { email: "test@example.com" },
      }),
      (e) => e.friendly.includes("unexpected response"),
    );
    assert.equal(requested, "http://localhost:3000/api/email/send");
    global.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    await assert.rejects(api("/api/email/send"), (e) =>
      e.friendly.includes("couldn’t reach"),
    );
    global.fetch = async () =>
      new Response(
        JSON.stringify({
          error: "Please wait before requesting another code.",
        }),
        { status: 429 },
      );
    await assert.rejects(
      api("/api/email/send"),
      (e) => e.friendly === "Please wait before requesting another code.",
    );
  } finally {
    global.fetch = priorFetch;
    global.window = priorWindow;
  }
});
