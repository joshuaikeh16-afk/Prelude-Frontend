// Capture callback metadata before the Auth SDK consumes and clears the URL.
// A Google authorization code is not a password-recovery request.
const authQuery = new URLSearchParams(location.search);
const authHash = new URLSearchParams(location.hash.slice(1));
const authCallback = {
  code: authQuery.get("code"),
  flowId: authQuery.get("flow_id"),
  error: authQuery.get("error") || authHash.get("error"),
  errorCode: authQuery.get("error_code") || authHash.get("error_code"),
  type: authQuery.get("type") || authHash.get("type"),
  hasTokens: authHash.has("access_token"),
};
// Public configuration only. Set apiBase to the backend origin when deployed separately.
window.PreludeConfig = {
  authCallback,
  passwordRecovery:
    authCallback.type === "recovery" ||
    (Boolean(authCallback.code) && /\/(?:reset-password|reset)\.html$/.test(location.pathname)),
apiBase: ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(
    location.hostname,
  )
    ? `${location.protocol || "http:"}//${location.hostname}:3000`
    : "https://prelude-one.vercel.app",
  ...window.PreludeConfig,
};
