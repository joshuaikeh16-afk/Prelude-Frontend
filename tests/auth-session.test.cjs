const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const configSource = fs.readFileSync(path.join(__dirname, '../js/config.js'), 'utf8');
function configAt(address) {
  const context = { URLSearchParams, location: new URL(address), window: {} };
  vm.runInNewContext(configSource, context);
  return context.window.PreludeConfig;
}
function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) };
}
function environment(address, auth) {
  global.location = new URL(address);
  global.window = { PreludeConfig: configAt(address) };
  global.sessionStorage = storage();
  global.history = { state: null, replaceState(_state, _title, url) { global.location = new URL(url); } };
  global.supabaseClient = { auth };
}
test('Google authorization codes do not enable password recovery', () => {
  assert.equal(configAt('https://prelude.test/signup.html?code=google').passwordRecovery, false);
  assert.equal(configAt('https://prelude.test/reset-password.html?code=reset').passwordRecovery, true);
  assert.equal(configAt('https://prelude.test/reset.html?code=reset').passwordRecovery, true);
  assert.equal(configAt('https://prelude.test/index.html#access_token=a&type=recovery').passwordRecovery, true);
  assert.equal(configAt('http://0.0.0.0:8080/signin.html').apiBase, 'http://0.0.0.0:3000');
});
test('callback code exchanges once, then removes only auth URL parameters', async () => {
  let exchanges = 0;
  environment('https://prelude.test/signup.html?code=one-use&view=past', {
    initialize: async () => ({ error: null }),
    exchangeCodeForSession: async code => { exchanges++; assert.equal(code, 'one-use'); return { data: { session: { user: { id: 'user-1' } } }, error: null }; },
  });
  const { initializeAuth } = await import('../js/auth-session.js');
  const result = await initializeAuth();
  assert.equal(exchanges, 1);
  assert.equal(result.recovery, false);
  assert.equal(result.session.user.id, 'user-1');
  assert.equal(location.search, '?view=past');
});
test('failed recovery never enables password editing with an unrelated existing session', async () => {
  environment('https://prelude.test/reset-password.html?code=expired', {
    initialize: async () => ({ error: null }),
    exchangeCodeForSession: async () => ({ error: { code: 'flow_state_expired' } }),
  });
  const { initializeAuth } = await import('../js/auth-session.js');
  const result = await initializeAuth();
  assert.equal(result.recovery, true);
  assert.match(result.error, /expired/);
  assert.equal(window.PreludeConfig.passwordRecovery, false);
  assert.equal(sessionStorage.getItem('prelude-recovery'), null);
});
test('implicit recovery waits for SDK and binds a short recovery marker to its user', async () => {
  let initialized = false;
  environment('https://prelude.test/reset-password.html#access_token=a&refresh_token=b&type=recovery', {
    initialize: async () => { initialized = true; return { error: null }; },
    getSession: async () => { assert.equal(initialized, true); return { data: { session: { user: { id: 'user-2' } } }, error: null }; },
  });
  const { initializeAuth } = await import('../js/auth-session.js');
  const result = await initializeAuth();
  assert.equal(result.recovery, true);
  assert.equal(location.hash, '');
  const marker = JSON.parse(sessionStorage.getItem('prelude-recovery'));
  assert.equal(marker.userId, 'user-2');
  assert.ok(marker.expires > Date.now());
});
test('OAuth cancellations are actionable and untrusted descriptions are not rendered', async () => {
  environment('https://prelude.test/signup.html#error=access_denied&error_description=untrusted', {});
  const { initializeAuth } = await import('../js/auth-session.js');
  const result = await initializeAuth();
  assert.match(result.error, /cancelled/);
  assert.ok(!result.error.includes('untrusted'));
  assert.equal(location.hash, '');
});
test('post-auth destinations are restricted to known local app pages', async () => {
  environment('https://prelude.test/signin.html', {});
  const { authDestination, rememberDestination } = await import('../js/auth-session.js');
  const user = { user_metadata: { prelude_profile: { complete: true, walkthrough_completed: true } } };
  sessionStorage.setItem('prelude-return-to', 'https://evil.example');
  assert.equal(authDestination(user), 'index.html');
  global.location = new URL('https://prelude.test/event.html?id=event-1#notes');
  rememberDestination();
  assert.equal(authDestination(user), 'event.html?id=event-1#notes');
  assert.equal(sessionStorage.getItem('prelude-return-to'), null);
});
test('Deleted-account sessions are cleared locally and return an unauthenticated user', async () => {
  let signouts = 0;
  environment('http://127.0.0.1:5500/settings.html', {
    getUser: async () => ({data: {user: null}, error: {code: 'user_not_found', status: 403}}),
    signOut: async options => {signouts++; assert.equal(options.scope, 'local'); return {error: null};},
  });
  global.localStorage = storage();
  window.PreludeConfig.authStorageKey = 'sb-test-auth-token';
  localStorage.setItem('sb-test-auth-token', 'stale-session');
  localStorage.setItem('sb-test-auth-token-user', 'deleted-user');
  localStorage.setItem('unrelated-draft', 'keep this');
  sessionStorage.setItem('prelude-recovery', 'stale-recovery');
  const {getUser} = await import('../js/data.js');
  assert.equal(await getUser(), null);
  assert.equal(signouts, 1);
  assert.equal(localStorage.getItem('sb-test-auth-token'), null);
  assert.equal(localStorage.getItem('sb-test-auth-token-user'), null);
  assert.equal(localStorage.getItem('unrelated-draft'), 'keep this');
  assert.equal(sessionStorage.getItem('prelude-recovery'), null);
  assert.match(sessionStorage.getItem('prelude-auth-error'), /sign in again/);
});
test('Network and permission failures do not erase valid saved sessions', async () => {
  let signouts = 0;
  const failure = {name: 'AuthRetryableFetchError', status: 503};
  environment('https://prelude.test/index.html', {
    getUser: async () => ({data: {user: null}, error: failure}),
    signOut: async () => {signouts++;},
  });
  const {getUser} = await import('../js/data.js');
  await assert.rejects(getUser(), error => error === failure);
  assert.equal(signouts, 0);
});
test('Invalid persisted credentials are removed even when local sign-out fails', async () => {
  environment('https://prelude.test/signin.html', {signOut: async () => {throw new Error('offline');}});
  global.localStorage = storage();
  window.PreludeConfig.authStorageKey = 'sb-test-auth-token';
  localStorage.setItem('sb-test-auth-token', 'stale-session');
  const {clearInvalidSession} = await import('../js/auth-session.js');
  await clearInvalidSession();
  assert.equal(localStorage.getItem('sb-test-auth-token'), null);
});

test('OAuth callback consumes the transient Google grant without changing the Prelude session', async () => {
  environment('https://prelude.test/index.html#access_token=prelude&type=signup', {
    initialize: async () => ({error: null}),
    getSession: async () => ({data: {session: {user: {id: 'user'}, access_token: 'prelude-access', refresh_token: 'prelude-refresh'}}, error: null}),
  });
  let grant = 'google-refresh';
  window.PreludeConfig.consumeGoogleGrant = () => {const value = grant; grant = undefined; return value;};
  const {initializeAuth} = await import('../js/auth-session.js');
  const result = await initializeAuth();
  assert.equal(result.session.provider_refresh_token, 'google-refresh');
  assert.equal(result.session.refresh_token, 'prelude-refresh'); assert.equal(grant, undefined);
});
