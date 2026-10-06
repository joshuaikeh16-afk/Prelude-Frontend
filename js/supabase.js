const SUPABASE_URL = "https://uhlznbcsqzbbklhahprk.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVobHpuYmNzcXpiYmtsaGFocHJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwNjE3NjcsImV4cCI6MjEwNTYzNzc2N30.iLMWyMNlW7yL1uIyzzQEoJlwAUrTlfP0r5Edj-j1JnI";

const authStorageKey = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
window.PreludeConfig.authStorageKey = authStorageKey;
// Persist Prelude's session, never Google's provider credentials. The optional
// Gmail grant survives only in memory until the callback hands it to the backend.
let googleGrant;
window.PreludeConfig.consumeGoogleGrant = () => {
  const value = googleGrant;
  googleGrant = undefined;
  return value;
};
function withoutProviderTokens(value, capture = false) {
  try {
    const session = JSON.parse(value);
    if (!session || typeof session !== "object" || Array.isArray(session)) return value;
    if (capture && typeof session.provider_refresh_token === "string") googleGrant = session.provider_refresh_token;
    delete session.provider_token;
    delete session.provider_refresh_token;
    return JSON.stringify(session);
  } catch { return value; } // PKCE verifiers are plain strings, not sessions.
}
const authStorage = {
  getItem(key) {
    const value = localStorage.getItem(key);
    if (key !== authStorageKey || !value) return value;
    const clean = withoutProviderTokens(value);
    if (clean !== value) localStorage.setItem(key, clean);
    return clean;
  },
  setItem(key, value) { localStorage.setItem(key, key === authStorageKey ? withoutProviderTokens(value, true) : value); },
  removeItem(key) { if (key === authStorageKey) googleGrant = undefined; localStorage.removeItem(key); },
};
const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      storageKey: authStorageKey,
      storage: authStorage,
      persistSession: true,
      autoRefreshToken: true,
      // Implicit callbacks are handled by the SDK. Code callbacks are exchanged
      // once by auth-session.js, including links created by an older PKCE client.
      detectSessionInUrl: !window.PreludeConfig?.authCallback?.code,
    },
  },
);
