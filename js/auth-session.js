export function invalidSavedSession(error) {
  return ["user_not_found", "session_not_found", "session_expired", "refresh_token_not_found", "refresh_token_already_used", "bad_jwt"].includes(error?.code);
}

export async function clearInvalidSession() {
  sessionStorage.setItem("prelude-auth-error", "Your saved sign-in is no longer valid. Please sign in again.");
  sessionStorage.removeItem("prelude-recovery");
  sessionStorage.removeItem("prelude-gmail-permission");
  window.PreludeConfig.passwordRecovery = false;
  try { await supabaseClient.auth.signOut({ scope: "local" }); }
  catch { /* Remove this project's persisted credentials below even if the network fails. */ }
  const key = window.PreludeConfig.authStorageKey;
  if (key && typeof localStorage !== "undefined") {
    for (const suffix of ["", "-user", "-code-verifier"]) localStorage.removeItem(key + suffix);
  }
}

export function authMessage(error, fallback = "We couldn’t complete that request. Please try again.") {
  if (error?.friendly) return error.friendly;
  const code = error?.code || error?.error_code || error?.details?.code;
  if (invalidSavedSession(error)) return "Your saved sign-in is no longer valid. Please sign in again.";
  if (code === "invalid_credentials") return "Your email or password is incorrect. Check both and try again.";
  if (code === "email_not_confirmed") return "Verify your email before signing in. Check your inbox for your verification email.";
  if (code === "weak_password") return "Choose a stronger password with at least 8 characters.";
  if (code === "same_password") return "Choose a password different from your current one.";
  if (code === "access_denied") return "Google sign-in was cancelled. Try again when you’re ready.";
  if (["over_request_rate_limit", "over_email_send_rate_limit"].includes(code) || error?.status === 429)
    return "Too many attempts. Wait a little before trying again.";
  if (["provider_disabled", "unsupported_provider"].includes(code) || /provider.*not enabled|unsupported provider/i.test(error?.message || ""))
    return "Google sign-in is temporarily unavailable. You can sign in with email instead.";
  if (["otp_expired", "flow_state_expired", "flow_state_not_found", "bad_code_verifier"].includes(code))
    return "This sign-in link has expired or was already used. Start again from this browser.";
  if (error?.name === "AuthRetryableFetchError" || error instanceof TypeError || globalThis.navigator?.onLine === false)
    return "We couldn’t connect. Check your connection and try again.";
  return fallback;
}

function clearCallbackUrl() {
  const url = new URL(location.href);
  for (const key of ["code", "flow_id", "error", "error_code", "error_description", "type"]) url.searchParams.delete(key);
  const hash = new URLSearchParams(url.hash.slice(1));
  if (hash.has("access_token") || hash.has("error") || hash.get("type") === "recovery") url.hash = "";
  history.replaceState(history.state, "", url.href);
}

export async function initializeAuth() {
  const config = window.PreludeConfig;
  const callback = config.authCallback || {};
  const isCallback = Boolean(callback.code || callback.error || callback.hasTokens || callback.type);
  const recovery = Boolean(config.passwordRecovery);
  if (!isCallback) return { recovery: false };
  try {
    if (callback.error) throw { code: callback.errorCode || callback.error };
    // initialize() exposes callback errors that getSession() alone would hide.
    if (supabaseClient.auth.initialize) {
      const initialized = await supabaseClient.auth.initialize();
      if (initialized.error) throw initialized.error;
    }
    let session;
    if (callback.code) {
      const result = await supabaseClient.auth.exchangeCodeForSession(
        callback.code,
        callback.flowId ? { flowId: callback.flowId } : undefined,
      );
      if (result.error) throw result.error;
      session = result.data?.session;
    } else {
      const result = await supabaseClient.auth.getSession();
      if (result.error) throw result.error;
      session = result.data?.session;
    }
    if (!session?.user) throw { code: "otp_expired" };
    const googleGrant = config.consumeGoogleGrant?.();
    if (!recovery && googleGrant && !session.provider_refresh_token) session.provider_refresh_token = googleGrant;
    if (recovery) sessionStorage.setItem("prelude-recovery", JSON.stringify({ userId: session.user.id, expires: Date.now() + 30 * 60 * 1000 }));
    return { recovery, session };
  } catch (error) {
    if (invalidSavedSession(error)) await clearInvalidSession();
    config.passwordRecovery = false;
    sessionStorage.removeItem("prelude-recovery");
    return {
      recovery,
      error: recovery
        ? "This reset link is invalid or has expired. Request a new link below."
        : authMessage(error, "We couldn’t finish Google sign-in. Try again from this browser."),
    };
  } finally {
    config.consumeGoogleGrant?.();
    clearCallbackUrl();
  }
}

export function rememberDestination() {
  const page = location.pathname.split("/").pop();
  if (/^(event|events|create|calendar|profile|settings|memories|goals|notes|schedule|reminders)\.html$/.test(page || ""))
    sessionStorage.setItem("prelude-return-to", `${page}${location.search}${location.hash}`);
}

export function authDestination(user) {
  const saved = sessionStorage.getItem("prelude-return-to");
  sessionStorage.removeItem("prelude-return-to");
  const profile = user?.user_metadata?.prelude_profile;
  if (!profile?.complete || !profile?.walkthrough_completed || !saved) return "index.html";
  // Only known local app pages may be resumed after authentication.
  return /^(event|events|create|calendar|profile|settings|memories|goals|notes|schedule|reminders)\.html(?:[?#].*)?$/.test(saved)
    ? saved
    : "index.html";
}
