import { api } from "./data.js";
export const gmailScope = "https://www.googleapis.com/auth/gmail.readonly";
export function googlePermissionOptions(enabled) {
  if (enabled) sessionStorage.setItem("prelude-gmail-permission", String(Date.now()));
  else sessionStorage.removeItem("prelude-gmail-permission");
  return enabled
    ? {scopes: gmailScope, queryParams: {access_type: "offline", prompt: "consent select_account"}}
    : {queryParams: {prompt: "select_account"}};
}
export async function finishGmailPermission(auth) {
  const requested = sessionStorage.getItem("prelude-gmail-permission");
  if (!requested) return;
  if (auth.error || auth.recovery) { sessionStorage.removeItem("prelude-gmail-permission"); return; }
  if (!auth.session) return;
  sessionStorage.removeItem("prelude-gmail-permission");
  const timestamp = Number(requested);
  if (!Number.isFinite(timestamp) || Date.now() - timestamp > 15 * 60 * 1000) return;
  let message;
  try {
    if (!auth.session.provider_refresh_token) throw new Error("Gmail access was not granted. You can allow it later in Settings.");
    await api("/api/mail/authorize", {method: "POST", authenticated: true, body: {refreshToken: auth.session.provider_refresh_token}});
    message = "Gmail access granted. Clear invitations will be created automatically; manage this in Settings.";
  } catch (error) {
    message = error.friendly || error.message || "You’re signed in. Gmail access couldn’t be saved; try Allow Gmail access in Settings.";
  } finally {
    delete auth.session.provider_refresh_token;
    delete auth.session.provider_token;
  }
  sessionStorage.setItem("prelude-flash", message);
}
