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
  vm.runInNewContext(output, {exports, require: name => dependencies[name] || (name === './frontend-origins' ? load('frontend-origins', env) : backendRequire(name)), Buffer, URL, URLSearchParams, AbortSignal, Intl, Date, fetch, process: {env}, console, ...globals}, {filename});
  return exports;
}

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
  assert.equal(result.holidays.length, 1);
  assert.equal(result.holidays[0].name, 'National');
});

test('Development preflight permits Live Server on 5500 and restricts untrusted origins', () => {
  const {options} = load('prelude-api', {NODE_ENV: 'development'});
  const response = options(new Request('http://127.0.0.1:3000/api/holidays', {headers: {Origin: 'http://127.0.0.1:5500'}}));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:5500');
  assert(response.headers.get('Access-Control-Allow-Headers').includes('Authorization'));
  assert.equal(options(new Request('http://127.0.0.1:3000/api/holidays', {headers: {Origin: 'https://attacker.example'}})).status, 403);
  const production = load('frontend-origins', {NODE_ENV: 'production', PRELUDE_FRONTEND_ORIGINS: 'https://app.example.com'});
  assert.equal(production.frontendOrigins().length, 1);
  assert(!production.frontendOrigins().includes('http://127.0.0.1:5500'));
});
