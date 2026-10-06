const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const backendRequire = createRequire(path.resolve(__dirname, '../../backend/package.json'));
const ts = backendRequire('typescript');
function load(file, dependencies, globals = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../../backend', file), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const exports = {};
  vm.runInNewContext(output, {exports, require: name => dependencies[name] || backendRequire(name), Buffer, URL, URLSearchParams, AbortSignal, Intl, Date, Request, console, process: {env: {}}, ...globals});
  return exports;
}
function fixture({busy = false, fail = false, auto = true, expired = false, pages = false, importFailure = false} = {}) {
  const connection = {id: 'connection', user_id: 'user', tokens_ciphertext: 'sealed', auto_import: auto, scan_after: '2026-10-01T00:00:00Z', scan_lease_until: '2026-10-06T00:03:00Z'};
  const state = {processed: new Set(['seen']), suggestions: [], fetched: [], imports: [], updates: [], queries: [], refreshed: 0};
  function from(table) {
    let operation = 'read', value, filters = [];
    const q = {
      select: () => q, eq: (key, v) => {filters.push([key,v]); return q;}, in: () => q, lt: () => q, limit: () => q,
      update: v => {operation = 'update'; value = v; return q;},
      upsert: v => {operation = 'upsert'; value = v; return q;}, delete: () => {operation = 'delete'; return q;},
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          let data = [];
          if (table === 'mail_connections' && operation === 'update') {state.updates.push(value); Object.assign(connection, value);}
          if (table === 'mail_processed_messages') {
            if (operation === 'read') data = [...state.processed].map(message_id => ({message_id}));
            if (operation === 'upsert') state.processed.add(value.message_id);
          }
          if (table === 'mail_event_suggestions') {
            if (operation === 'upsert' && !state.suggestions.some(s => s.source_key === value.source_key)) {
              const row = {...value, id: `suggestion-${state.suggestions.length}`, status: 'pending'}; state.suggestions.push(row); data = [{id: row.id}];
            } else if (operation === 'read') data = state.suggestions.filter(s => filters.every(([key,v]) => s[key] === v));
          }
          return {data, error: null};
        }).then(resolve, reject);
      }
    }; return q;
  }
  const client = {from, rpc: async (name, args) => {
    if (name === 'prelude_claim_mail_scan') return {data: busy ? [] : [{...connection}], error: null};
    assert.equal(name, 'prelude_import_mail_event'); state.imports.push(args.p_suggestion);
    if (importFailure) return {data: null, error: {message: 'Fixture import failure'}};
    state.suggestions.find(s => s.id === args.p_suggestion).status = 'imported';
    return {data: 'event-id', error: null};
  }};
  const dependencies = {
    '@/lib/prelude-api': {admin: () => client},
    '@/lib/mail-security': {
      unseal: () => ({accessToken: 'private', refreshToken: 'private-refresh', expiresAt: expired ? 0 : Date.now() + 3600000}),
      seal: value => {assert.equal(value.refreshToken, 'private-refresh'); return 'new-encrypted';},
      googleTokens: async () => {state.refreshed++; return {access_token: 'renewed', expires_in: 3600};}
    },
    '@/lib/mail-events': {validZone: () => 'Africa/Lagos', detectMailEvents: (_subject, body) => [{key: body, confidence: body === 'clear' ? 'clear' : 'review', payload: {title: 'Fixture', date: '2026-10-09', time: '10:00', timezone: 'Africa/Lagos', location: '', description: ''}}]},
  };
  const scanner = load('lib/gmail.ts', dependencies, {fetch: async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/messages')) {state.queries.push(parsed.searchParams); return Response.json({messages: [{id: 'seen'}, {id: 'clear'}, {id: 'review'}], ...(pages && state.queries.length === 1 ? {nextPageToken: 'page-2'} : {})});}
    const id = parsed.pathname.split('/').pop(); state.fetched.push(id);
    if (fail && id === 'review') return new Response('{}', {status: 503});
    return Response.json({payload: {mimeType: 'text/plain', headers: [{name: 'Subject', value: 'Fixture meeting'}], body: {data: Buffer.from(id).toString('base64url')}}});
  }});
  return {scanner, state, connection};
}
test('Scanner skips processed bodies, auto-imports only clear events and advances checkpoint', async () => {
  const {scanner, state, connection} = fixture();
  const result = await scanner.scanMailbox(connection, 'Africa/Lagos');
  assert.equal(result.checked, 2); assert.equal(result.imported, 1);
  assert.deepEqual(state.fetched.sort(), ['clear', 'review']);
  assert.equal(state.suggestions.find(s => s.confidence === 'review').status, 'pending');
  assert(state.updates.some(v => v.scan_after && v.scan_window_end === null));
  assert.equal(connection.scan_lease_until, null);
  assert.equal(state.queries[0].get('maxResults'), '20');
  assert(state.queries[0].get('q').includes('after:'));
  await scanner.scanMailbox(connection, 'Africa/Lagos');
  assert.equal(state.fetched.length, 2); assert.equal(state.imports.length, 1);
});
test('Lease prevents overlapping scans and opted-out mailboxes retain review suggestions', async () => {
  const busy = fixture({busy: true});
  assert.equal((await busy.scanner.scanMailbox(busy.connection, 'UTC')).busy, true);
  assert.equal(busy.state.fetched.length, 0);
  const optedOut = fixture({auto: false});
  await optedOut.scanner.scanMailbox(optedOut.connection, 'UTC');
  assert.equal(optedOut.state.imports.length, 0); assert.equal(optedOut.state.suggestions.length, 2);
});
test('Failure preserves watermark, saves successful message IDs and releases lease', async () => {
  const {scanner, state, connection} = fixture({fail: true});
  await assert.rejects(scanner.scanMailbox(connection, 'UTC'), /could not be checked/);
  assert.equal(connection.scan_after, '2026-10-01T00:00:00Z');
  assert(state.processed.has('clear')); assert(!state.processed.has('review'));
  assert(state.updates.some(v => v.last_scan_error)); assert.equal(connection.scan_lease_until, null);
});
test('Expired access token refresh remains encrypted server-side', async () => {
  const {scanner, state, connection} = fixture({expired: true});
  await scanner.scanMailbox(connection, 'UTC');
  assert.equal(state.refreshed, 1); assert(state.updates.some(v => v.tokens_ciphertext === 'new-encrypted'));
});
test('Dispatch rejects absent/incorrect secret and supports authenticated scheduler GET and POST', async () => {
  let scans = 0, limit;
  const q = {delete: () => q, lt: () => q, select: () => q, or: () => q, order: () => q,
    limit: value => {limit = value; return q;}, then: resolve => Promise.resolve({data: [{id: 'mail', user_id: 'user'}], error: null}).then(resolve)};
  const route = load('app/api/mail/dispatch/route.ts', {'@/lib/prelude-api': {admin: () => ({from: () => q, auth: {admin: {getUserById: async () => ({data: {user: {user_metadata: {}}}})}}})}, '@/lib/gmail': {scanMailbox: async () => {scans++; return {busy: false};}}}, {process: {env: {CRON_SECRET: 'fixture-secret'}}});
  assert.equal((await route.GET(new Request('http://localhost/api/mail/dispatch'))).status, 401); assert.equal(scans, 0);
  assert.equal((await route.POST(new Request('http://localhost/api/mail/dispatch', {headers: {authorization: 'Bearer wrong'}}))).status, 401);
  const response = await route.GET(new Request('http://localhost/api/mail/dispatch', {headers: {authorization: 'Bearer fixture-secret'}}));
  assert.equal(response.status, 200); assert.equal(scans, 1); assert.equal(limit, 3);
});

test('Pagination preserves a stable window and completes before advancing the watermark', async () => {
  const {scanner, state, connection} = fixture({pages: true});
  const before = connection.scan_after;
  assert.equal((await scanner.scanMailbox(connection, 'UTC')).hasMore, true);
  assert.equal(connection.scan_after, before); assert.equal(connection.scan_cursor, 'page-2');
  assert(connection.scan_window_end);
  await scanner.scanMailbox(connection, 'UTC');
  assert.equal(state.queries[1].get('q'), state.queries[0].get('q'));
  assert.equal(state.queries[1].get('pageToken'), 'page-2');
  assert.equal(connection.scan_cursor, null); assert.equal(connection.scan_window_end, null);
  assert.notEqual(connection.scan_after, before);
});

test('Import failure retains pending invitations while new-mail progress still advances', async () => {
  const {scanner, state, connection} = fixture({importFailure: true});
  const result = await scanner.scanMailbox(connection, 'UTC');
  assert.equal(result.importFailures, 1); assert.equal(result.imported, 0);
  assert(state.suggestions.every(s => s.status === 'pending'));
  assert(state.updates.some(value => value.scan_after && value.last_scan_error));
  const before = state.fetched.length;
  await scanner.scanMailbox(connection, 'UTC');
  assert.equal(state.fetched.length, before); assert.equal(state.imports.length, 2);
});
test('Manual scans enforce mailbox ownership before acquiring a scan lease', async () => {
  let scans = 0;
  const filters = [];
  const q = {select: () => q, eq: (key,value) => {filters.push([key,value]); return q;}, maybeSingle: async () => ({data: null, error: null})};
  const route = load('app/api/mail/scan/route.ts', {
    '@/lib/prelude-api': {authenticated: async () => ({client: {from: () => q}, user: {id: 'owner'}}), options: () => {}, reply: (_request, body) => Response.json(body), failure: (_request, error, status) => Response.json({error}, {status})},
    '@/lib/gmail': {scanMailbox: async () => {scans++;}},
  });
  const response = await route.POST(new Request('http://localhost/api/mail/scan', {method: 'POST', body: JSON.stringify({id: 'foreign-mailbox'})}));
  assert.equal(response.status, 404); assert.equal(scans, 0);
  assert(filters.some(([key,value]) => key === 'user_id' && value === 'owner'));
});
test('Disconnect removes owned credentials before best-effort Google revocation', async () => {
  let removed = false, revoked = false;
  const filters = [];
  const q = {delete: () => q, select: () => q, eq: (key,value) => {filters.push([key,value]); return q;}, maybeSingle: async () => {removed = true; return {data: {tokens_ciphertext: 'ciphertext'}, error: null};}};
  const route = load('app/api/mail/connections/route.ts', {
    '@/lib/prelude-api': {authenticated: async () => ({client: {from: () => q}, user: {id: 'owner'}}), options: () => {}, reply: (_request, body) => Response.json(body), failure: (_request, error) => Response.json({error}, {status: 400})},
    '@/lib/mail-security': {unseal: value => {assert.equal(value, 'ciphertext'); return {refreshToken: 'fixture-private'};}},
  }, {fetch: async (url, options) => {
    assert(removed); assert.equal(url, 'https://oauth2.googleapis.com/revoke');
    assert.equal(options.body.get('token'), 'fixture-private'); revoked = true;
    return new Response('', {status: 200});
  }});
  const response = await route.DELETE(new Request('http://localhost/api/mail/connections', {method: 'DELETE', body: JSON.stringify({id: 'mailbox'})}));
  assert.equal(response.status, 200); assert.equal((await response.json()).revoked, true); assert(revoked);
  assert(filters.some(([key,value]) => key === 'user_id' && value === 'owner'));
});
