const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const backendRequire = createRequire(path.resolve(__dirname, '../../backend/package.json'));
const ts = backendRequire('typescript');
function load(name, env = {}, globals = {}, dependencies = {}) {
  const filename = path.resolve(__dirname, '../../backend/lib/' + name + '.ts');
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const exports = {};
  vm.runInNewContext(output, {exports, require: name => dependencies[name] || (name === "./frontend-origins" ? load("frontend-origins", env) : backendRequire(name)), Buffer, URL, URLSearchParams, AbortSignal, Intl, Date, fetch,
    process: {env}, console, ...globals}, {filename});
  return exports;
}
const events = load('mail-events');
const now = new Date('2026-10-05T08:00:00Z');
function invite(start, extra = '') { return `BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:meeting-1\r\nSUMMARY:Team meeting\r\n${start}\r\n${extra}\r\nEND:VEVENT\r\nEND:VCALENDAR`; }
test('UTC invitation converts across midnight and deduplicates by UID', () => {
  const first = events.detectMailEvents('Invitation', '', [invite('DTSTART:20261006T233000Z')], 'Africa/Lagos', now)[0];
  assert.equal(first.confidence, 'clear'); assert.equal(first.payload.date, '2026-10-07'); assert.equal(first.payload.time, '00:30');
  const second = events.detectMailEvents('Reminder', '', [invite('DTSTART:20261006T233000Z')], 'Africa/Lagos', now)[0];
  assert.equal(first.key, second.key);
});
test('Explicit timezone invitations auto-import; floating times need review', () => {
  assert.equal(events.detectMailEvents('Invite', '', [invite('DTSTART;TZID=Europe/London:20261010T140000')], 'Africa/Lagos', now)[0].confidence, 'clear');
  assert.equal(events.detectMailEvents('Invite', '', [invite('DTSTART:20261010T140000')], 'Africa/Lagos', now)[0].confidence, 'review');
  assert.equal(events.detectMailEvents('Invite', '', [invite('DTSTART;VALUE=DATE:20261010')], 'Africa/Lagos', now)[0].payload.time, '');
});
test('Cancelled, recurring, past and invalid invitations never create events', () => {
  for (const calendar of [invite('DTSTART:20261001T140000Z'), invite('DTSTART:20261005T070000Z'), invite('DTSTART:20260230T140000Z'),
    invite('DTSTART:20261010T140000Z', 'STATUS:CANCELLED'), invite('DTSTART:20261010T140000Z', 'RRULE:FREQ=WEEKLY'), invite('DTSTART:20261010T140000Z').replace('METHOD:REQUEST', 'METHOD:CANCEL')])
    assert.equal(events.detectMailEvents('Invite', '', [calendar], 'Africa/Lagos', now).length, 0);
});
test('Plain email dates are review suggestions; relative dates are not guessed', () => {
  for (const date of ['2026-10-12', '12 October 2026', 'October 12, 2026']) {
    const result = events.detectMailEvents('Appointment confirmed', `Date: ${date}\nTime: 2pm\nVenue: Lagos`, [], 'Africa/Lagos', now)[0];
    assert.equal(result.confidence, 'review'); assert.equal(result.payload.date, '2026-10-12'); assert.equal(result.payload.time, '14:00');
  }
  assert.equal(events.detectMailEvents('Meeting', 'See you next Friday', [], 'Africa/Lagos', now).length, 0);
});
test('Email OAuth tokens are encrypted and reject tampering', () => {
  const {seal, unseal} = load('mail-security', {MAIL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64')});
  const sealed = seal({refreshToken: 'private-refresh-token'});
  assert(!Buffer.from(sealed, 'base64').includes(Buffer.from('private-refresh-token')));
  assert.equal(unseal(sealed).refreshToken, 'private-refresh-token');
  const tampered = Buffer.from(sealed, 'base64'); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => unseal(tampered.toString('base64')));
});
test('Gmail OAuth return destination rejects external redirects', () => {
  const {allowedReturn} = load('mail-security', {PRELUDE_FRONTEND_ORIGINS: 'http://localhost:8081'});
  const request = new Request('http://localhost:3000/api/mail/connect');
  assert.equal(allowedReturn(request, 'http://localhost:8081/settings.html'), 'http://localhost:8081/settings.html#email-import');
  assert.throws(() => allowedReturn(request, 'https://attacker.example/settings.html'));
  assert.throws(() => allowedReturn(request, 'http://localhost:8081/other.html'));
});
test('Nigeria works without holiday credentials and reports partial coverage', async () => {
  const {getHolidays} = load('holidays');
  const result = await getHolidays('NG', 2026, async () => new Response('', {status: 404}));
  assert(result.available && result.partial);
  assert(result.holidays.some(h => h.date === '2026-10-01' && h.name === 'Independence Day'));
  assert(result.holidays.some(h => h.date === '2026-04-03' && h.name === 'Good Friday'));
  assert(result.holidays.some(h => h.date === '2026-04-06' && h.name === 'Easter Monday'));
  assert.equal(result.holidays.filter(h => /eid/i.test(h.name)).length, 5);
  const future = await getHolidays('NG', 2027, async () => new Response('', {status: 404}));
  assert(!future.holidays.some(h => /eid/i.test(h.name)));
});
test('National holiday filtering excludes regional dates and falls back if primary fails', async () => {
  const {getHolidays} = load('holidays', {CALENDARIFIC_API_KEY: 'test'});
  let count = 0;
  const result = await getHolidays('US', 2026, async () => ++count === 1 ? new Response('{}', {status: 503}) : Response.json([
    {name: 'National', date: '2026-01-01', global: true, types: ['Public']},
    {name: 'Regional', date: '2026-02-01', global: false, types: ['Public']},
  ]));
  assert.equal(result.holidays.length, 1); assert.equal(result.holidays[0].name, 'National');
});
test('Development preflight permits Live Server on 5500 and restricts untrusted origins', () => {
  const {options} = load('prelude-api', {NODE_ENV: 'development'});
  const response = options(new Request('http://127.0.0.1:3000/api/mail/connections', {headers: {Origin: 'http://127.0.0.1:5500'}}));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:5500');
  assert(response.headers.get('Access-Control-Allow-Headers').includes('Authorization'));
  assert.equal(options(new Request('http://127.0.0.1:3000/api/mail/connections', {headers: {Origin: 'https://attacker.example'}})).status, 403);
  const production = load('frontend-origins', {NODE_ENV: 'production', PRELUDE_FRONTEND_ORIGINS: 'https://app.example.com'});
  assert.equal(production.frontendOrigins().length, 1);
  assert(!production.frontendOrigins().includes('http://127.0.0.1:5500'));
});
test('Sign-in Gmail permission verifies provider identity and scopes before saving', async () => {
  let email = 'user@gmail.com', scope = 'https://www.googleapis.com/auth/gmail.readonly', saved = 0;
  const user = {id: 'user-id', identities: [{provider: 'google', identity_data: {email: 'user@gmail.com'}}]};
  const client = {from: () => ({upsert: async row => { saved++; assert.equal(row.user_id, user.id); assert.equal(row.email, 'user@gmail.com'); return {error: null}; }})};
  const dependencies = {
    '@/lib/prelude-api': {
      authenticated: async () => ({client, user}), options: () => Response.json({}),
      reply: (_request, data, status = 200) => Response.json(data, {status}),
      failure: (_request, error, status = 400) => Response.json({error}, {status}),
    },
    '@/lib/mail-security': {googleTokens: async () => ({access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope}), seal: () => 'encrypted'},
  };
  const route = load('../app/api/mail/authorize/route', {}, {fetch: async () => Response.json({emailAddress: email})}, dependencies);
  const request = () => new Request('http://127.0.0.1:3000/api/mail/authorize', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({refreshToken: 'refresh'})});
  assert.equal((await route.POST(request())).status, 200); assert.equal(saved, 1);
  email = 'different@gmail.com';
  assert.equal((await route.POST(request())).status, 403); assert.equal(saved, 1);
  email = 'user@gmail.com'; scope = 'openid email profile';
  assert.equal((await route.POST(request())).status, 403); assert.equal(saved, 1);
});

test('Common explicit date and time variations extract deterministically', () => {
  for (const date of ['9 October 2026', '9th October 2026', '9th of October 2026', 'October 9 2026', 'October 9th, 2026', 'Oct 9 2026', '2026-10-09']) {
    for (const [time, expected] of [['10:00 AM', '10:00'], ['10am', '10:00'], ['10 AM', '10:00'], ['14:30', '14:30']]) {
      const result = events.detectMailEvents('Important Meeting', `Dear Joshua,\n\nWe have a meeting.\n\nVenue: Stadium\nTime: ${time}\nDate: ${date}`, [], 'Africa/Lagos', now)[0];
      assert.equal(result.payload.title, 'Important Meeting');
      assert.equal(result.payload.date, '2026-10-09'); assert.equal(result.payload.time, expected);
      assert.equal(result.payload.location, 'Stadium'); assert.equal(result.confidence, 'review');
    }
  }
});
test('Automatic plain email confidence requires labelled confirmation and explicit timezone', () => {
  const body = 'We have a meeting.\nVenue: Stadium\nTime: 10 AM\nDate: 9th of October 2026\nTimezone: Africa/Lagos';
  assert.equal(events.detectMailEvents('Important Meeting', body, [], 'UTC', now)[0].confidence, 'clear');
  for (const changed of [body.replace('We have a meeting.', 'Maybe we could have a meeting.'), body + '\nAlternatively 10 October 2026', body + '\nOr at 11 AM', body.replace('Africa/Lagos', 'invalid'), body.replace('Date:', 'Discussed on'), body + '\nOn Monday someone wrote:'])
    assert.equal(events.detectMailEvents('Important Meeting', changed, [], 'UTC', now)[0].confidence, 'review');
  assert.equal(events.detectMailEvents('Meeting', 'Date: 09/10/26\nTime: 10am', [], 'Africa/Lagos', now).length, 0);
  assert.equal(events.detectMailEvents('Meeting', 'Sometime next week', [], 'Africa/Lagos', now).length, 0);
  assert.equal(events.detectMailEvents('Meeting', 'Date: 31 February 2026', [], 'Africa/Lagos', now).length, 0);
  assert.equal(events.detectMailEvents('Discussion', 'Venue: Stadium\nTime: 10am\nDate: 9 October 2026', [], 'Africa/Lagos', now).length, 0);
});
test('Skipped calendar invitations are not resurrected from accompanying email text', () => {
  const body = 'Meeting confirmed\nDate: 9 October 2026\nTime: 10am\nVenue: Stadium\nTimezone: Africa/Lagos';
  assert.equal(events.detectMailEvents('Meeting', body, [invite('DTSTART:20261010T140000Z', 'STATUS:CANCELLED')], 'Africa/Lagos', now).length, 0);
});
