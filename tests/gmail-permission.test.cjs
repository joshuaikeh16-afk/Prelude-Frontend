const {test} = require('node:test');
const assert = require('node:assert/strict');
function environment() {
  const values = new Map();
  global.sessionStorage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key)};
  global.window = {PreludeConfig: {apiBase: 'http://127.0.0.1:3000'}};
  global.supabaseClient = {auth: {getSession: async () => ({data: {session: {access_token: 'prelude-session'}}})}};
}
test('Google sign-in requests Gmail scopes only when the user selects permission', async () => {
  environment();
  const {googlePermissionOptions, gmailScope} = await import('../js/gmail-permission.js');
  assert.equal(googlePermissionOptions(false).scopes, undefined);
  assert.equal(sessionStorage.getItem('prelude-gmail-permission'), null);
  const enabled = googlePermissionOptions(true);
  assert.equal(enabled.scopes, gmailScope);
  assert.equal(enabled.queryParams.access_type, 'offline');
  assert(enabled.queryParams.prompt.includes('consent'));
});
test('Gmail consent is saved after sign-in once, without separately connecting', async () => {
  environment();
  const {googlePermissionOptions, finishGmailPermission} = await import('../js/gmail-permission.js');
  googlePermissionOptions(true);
  const original = global.fetch;
  let requests = 0;
  global.fetch = async (url, options) => {
    requests++;
    assert.equal(url, 'http://127.0.0.1:3000/api/mail/authorize');
    assert.equal(options.headers.Authorization, 'Bearer prelude-session');
    assert.equal(JSON.parse(options.body).refreshToken, 'google-refresh');
    return Response.json({success: true});
  };
  try {
    await finishGmailPermission({session: {provider_refresh_token: 'google-refresh'}});
    await finishGmailPermission({session: {provider_refresh_token: 'google-refresh'}});
    assert.equal(requests, 1);
    assert(sessionStorage.getItem('prelude-flash').includes('Gmail access granted'));
  } finally { global.fetch = original; }
});
test('Declined Gmail permission preserves normal sign-in and offers Settings', async () => {
  environment();
  const {googlePermissionOptions, finishGmailPermission} = await import('../js/gmail-permission.js');
  googlePermissionOptions(true);
  await finishGmailPermission({session: {user: {id: 'signed-in-user'}}});
  assert(sessionStorage.getItem('prelude-flash').includes('Settings'));
  assert.equal(sessionStorage.getItem('prelude-gmail-permission'), null);
  googlePermissionOptions(true);
  await finishGmailPermission({recovery: true, session: {provider_refresh_token: 'not-a-mail-flow'}});
  assert.equal(sessionStorage.getItem('prelude-gmail-permission'), null);
});
