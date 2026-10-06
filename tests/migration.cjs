const { PGlite } = require("@electric-sql/pglite");
const fs = require("fs");
(async () => {
  const db = new PGlite();
  await db.exec(`
create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role')$$;
create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
create table public.events(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),title text,date date,time time,timezone text not null default 'Africa/Lagos',location text,status text not null default 'upcoming',created_at timestamptz default now(),updated_at timestamptz default now(),image_path text,is_priority boolean default false,description text,source_event_id uuid references public.events(id) on delete set null);
create table public.profiles(id uuid primary key references auth.users(id),display_name text,created_at timestamptz default now());
create table public.goals(id uuid primary key default gen_random_uuid(),event_id uuid references public.events(id) on delete cascade,content text,created_at timestamptz default now());
create table public.tasks(id uuid primary key default gen_random_uuid(),event_id uuid references public.events(id) on delete cascade,title text,completed boolean default false,due_date date,created_at timestamptz default now());
create table public.notes(id uuid primary key default gen_random_uuid(),event_id uuid references public.events(id) on delete cascade,content text,created_at timestamptz default now(),updated_at timestamptz default now());
create table public.schedule_items(id uuid primary key default gen_random_uuid(),event_id uuid references public.events(id) on delete cascade,title text,start_time timestamptz,end_time timestamptz,created_at timestamptz default now());
create table public.reminders(id uuid primary key default gen_random_uuid(),event_id uuid references public.events(id) on delete cascade,task_id uuid references public.tasks(id) on delete cascade,title text,remind_at timestamptz,status text default 'pending',delivery_method text default 'push',sent_at timestamptz,created_at timestamptz default now());
create table public.push_subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),endpoint text unique,p256dh_key text,auth_key text,created_at timestamptz default now());
create table public.email_verification_otps(id uuid primary key default gen_random_uuid(),email text,otp_code_hash text,attempts_used integer default 0,expires_at timestamptz,invalidated_at timestamptz,created_at timestamptz default now());
create table public.phone_verification_otps(id uuid primary key default gen_random_uuid());
grant usage on schema public,auth to authenticated,anon,service_role;
grant all on all tables in schema public to service_role;
`);
  try {
    await db.exec(
      fs.readFileSync(
        require("node:path").resolve(
          __dirname,
          "../../backend/supabase/migrations/20261002_coherent_v1.sql",
        ),
        "utf8",
      ),
    );
    console.log("Migration executes successfully");
    await db.exec(
      fs.readFileSync(
        require("node:path").resolve(
          __dirname,
          "../../backend/supabase/migrations/20261002_coherent_v1.sql",
        ),
        "utf8",
      ),
    );
    console.log("Migration can be reapplied");
    const mailMigration = fs.readFileSync(require("node:path").resolve(__dirname, "../../backend/supabase/migrations/20261005_email_import.sql"), "utf8");
    await db.exec(mailMigration);
    await db.exec(mailMigration);
    console.log("Email import migration executes and can be reapplied");
    const background = fs.readFileSync(require("node:path").resolve(__dirname, "../../backend/supabase/migrations/20261006_mail_background_scanning.sql"), "utf8");
    await db.exec(background);
    await db.exec(background);
    console.log("Background scan migration executes and can be reapplied");
  } catch (e) {
    console.error("MIGRATION ERROR", e.message, e.query);
    process.exit(1);
  }
  const a = "11111111-1111-4111-8111-111111111111",
    b = "22222222-2222-4222-8222-222222222222";
  await db.query("insert into auth.users values($1),($2)", [a, b]);
  await db.exec(
    `set role authenticated;set request.jwt.claim.sub='${a}';set request.jwt.claim.role='authenticated';`,
  );
  const date = (
    await db.query("select (now() at time zone 'Africa/Lagos')::date+3 as d")
  ).rows[0].d;
  const payload = {
    title: "Preparation test",
    date: date.toISOString?.().slice(0, 10) || String(date).slice(0, 10),
    timezone: "Africa/Lagos",
    location: { label: "Test venue", lat: 6.5, lon: 3.3 },
    goals: [
      {
        title: "Be ready",
        tasks: [{ title: "First step", duration_minutes: 10 }],
      },
    ],
    tasks: [{ title: "Second step", duration_minutes: 5 }],
    notes: [{ content: "Live note" }],
    schedule: [],
  };
  const e = (
    await db.query("select public.prelude_create_event($1) as id", [
      JSON.stringify(payload),
    ])
  ).rows[0].id;
  console.log("Atomic event creation succeeds", e);
  const tasks = (
    await db.query("select * from tasks where event_id=$1 order by title", [e])
  ).rows;
  await db.query("select prelude_timer($1,$2)", [tasks[0].id, "start"]);
  await db.query("select prelude_timer($1,$2)", [tasks[0].id, "pause"]);
  try {
    await db.query("select prelude_timer($1,$2)", [tasks[1].id, "start"]);
    throw Error("Concurrent timers allowed");
  } catch (err) {
    if (!err.message.includes("Finish or stop")) throw err;
    console.log("One active timer enforced");
  }
  const stop = (
    await db.query("select prelude_timer($1,$2) as session", [
      tasks[0].id,
      "stop",
    ])
  ).rows[0].session;
  if (
    typeof stop.remaining_seconds !== "number" ||
    stop.remaining_seconds < 590
  )
    throw Error("Stop did not retain time");
  await db.query("select prelude_timer($1,$2)", [tasks[1].id, "start"]);
  await db.query("update tasks set completed=true where id=$1", [tasks[1].id]);
  console.log("Pause, stop, saved time, and completion work");
  await db.exec(`set request.jwt.claim.sub='${b}';`);
  if ((await db.query("select * from events")).rows.length)
    throw Error("Ownership leak");
  try {
    await db.query("select prelude_timer($1,$2)", [tasks[0].id, "start"]);
    throw Error("Foreign timer allowed");
  } catch (err) {
    if (!err.message.includes("unavailable")) throw err;
  }
  console.log("Ownership and RPC authorization work");
  await db.exec(`set request.jwt.claim.sub='${a}';`);
  try {
    await db.query("update events set title=$1 where id=$2", ["Changed", e]);
    throw Error("Identity unlocked");
  } catch (err) {
    if (!err.message.includes("identity")) throw err;
  }
  console.log("Event identity locks");

  const localToday = (
    await db.query("select (now() at time zone 'Africa/Lagos')::date as d")
  ).rows[0].d;
  const late = (
    await db.query("select prelude_create_event($1) as id", [
      JSON.stringify({
        title: "Late today",
        date:
          localToday.toISOString?.().slice(0, 10) ||
          String(localToday).slice(0, 10),
        time: "00:00",
        timezone: "Africa/Lagos",
        tasks: [{ title: "Late task" }],
      }),
    ])
  ).rows[0].id;
  const grace = (
    await db.query(
      "select preparation_deadline=((date+1)::timestamp at time zone timezone) as ok from events where id=$1",
      [late],
    )
  ).rows[0].ok;
  if (!grace) throw Error("Late creation grace failed");
  await db.query("update events set time='01:00' where id=$1", [late]);
  if (
    !(
      await db.query(
        "select preparation_deadline=((date+1)::timestamp at time zone timezone) as ok from events where id=$1",
        [late],
      )
    ).rows[0].ok
  )
    throw Error("Editing time removed midnight grace");
  console.log("Late-created events retain midnight grace");
  await db.query("select prelude_complete_event($1)", [late]);
  await db.query(
    "insert into event_reflections(event_id,content) values($1,$2)",
    [late, "Remember this day"],
  );
  try {
    await db.query("insert into tasks(event_id,title) values($1,$2)", [
      late,
      "Too late",
    ]);
    throw Error("Past preparation writable");
  } catch (err) {
    if (!err.message.includes("read only")) throw err;
  }
  try {
    await db.query("update events set status='upcoming' where id=$1", [late]);
    throw Error("Past event reopened");
  } catch (err) {
    if (!err.message.includes("read only")) throw err;
  }
  console.log("Completion preserves read-only history and editable memories");
  await db.query("select prelude_delete_event($1)", [late]);
  try {
    await db.query(
      "insert into schedule_items(event_id,title,start_time) values($1,$2,$3)",
      [e, "Too late", new Date(Date.now() + 10 * 864e5).toISOString()],
    );
    throw Error("Schedule date unchecked");
  } catch (err) {
    if (!err.message.includes("after the event")) throw err;
  }
  console.log("Schedule cannot fall after event day");
  await db.query("select prelude_delete_event($1)", [e]);
  console.log("Cascading deletion works");
  await db.exec("reset role;set request.jwt.claim.role='service_role';");
  const otp = (
    await db.query("select prelude_issue_otp('person@example.com','hash',true)")
  ).rows[0];
  if (!otp) throw Error("No OTP");
  const verified = (
    await db.query(
      "select prelude_verify_otp('person@example.com','hash','proof') as ok",
    )
  ).rows[0].ok;
  if (!verified) throw Error("OTP rejected");
  const proof = (
    await db.query(
      "select prelude_consume_proof('person@example.com','proof') as ok",
    )
  ).rows[0].ok;
  const replay = (
    await db.query(
      "select prelude_consume_proof('person@example.com','proof') as ok",
    )
  ).rows[0].ok;
  if (!proof || replay) throw Error("Proof replay");
  console.log("Atomic OTP and one-use signup proof work");

  try {
    await db.query(
      "select prelude_issue_otp('person@example.com','second',true)",
    );
    throw Error("Cooldown bypassed");
  } catch (err) {
    if (!err.message.includes("Please wait")) throw err;
  }
  await db.query(
    "select prelude_issue_otp('attempts@example.com','correct',false)",
  );
  for (let i = 0; i < 3; i++)
    await db.query(
      "select prelude_verify_otp('attempts@example.com','wrong','badproof')",
    );
  if (
    (
      await db.query(
        "select prelude_verify_otp('attempts@example.com','correct','badproof') as ok",
      )
    ).rows[0].ok
  )
    throw Error("Attempt limit bypassed");
  console.log("OTP cooldown and three-attempt limit enforced");
  await db.exec(`alter table events disable trigger prelude_event_rules;`);
  const legacy = (
    await db.query(
      "insert into events(user_id,title,date,timezone,status,preparation_deadline) values($1,'Grace yesterday',(now() at time zone 'Africa/Lagos')::date-1,'Africa/Lagos','upcoming',now()-interval '1 day'),($1,'Grace expired',(now() at time zone 'Africa/Lagos')::date-2,'Africa/Lagos','upcoming',now()-interval '2 days') returning id,title",
      [a],
    )
  ).rows;
  await db.exec(
    `alter table events enable trigger prelude_event_rules;set role authenticated;set request.jwt.claim.sub='${a}';set request.jwt.claim.role='authenticated';`,
  );
  await db.query("select prelude_sync_events()");
  const states = (await db.query("select title,status from events")).rows;
  if (
    states.find((e) => e.title === "Grace yesterday")?.status !== "upcoming" ||
    states.find((e) => e.title === "Grace expired")?.status !== "past"
  )
    throw Error("Auto-completion grace wrong");
  console.log("Auto-completion occurs after the full grace day");
  await db.exec("reset role;set request.jwt.claim.sub='';set request.jwt.claim.role='service_role';");
  const assert = require("node:assert/strict");
  const connection = (await db.query("insert into mail_connections(user_id,email,tokens_ciphertext) values($1,'connected@example.com','encrypted') returning id", [a])).rows[0].id;
  assert.equal((await db.query("select * from prelude_claim_mail_scan($1)", [connection])).rows.length, 1);
  assert.equal((await db.query("select * from prelude_claim_mail_scan($1)", [connection])).rows.length, 0);
  await db.query("update mail_connections set scan_lease_until=now()-interval '1 second' where id=$1", [connection]);
  assert.equal((await db.query("select * from prelude_claim_mail_scan($1)", [connection])).rows.length, 1);
  await db.query("insert into mail_processed_messages(connection_id,message_id) values($1,'fixture-message')", [connection]);
  const mailPayload = {title: "Email meeting", date: payload.date, time: "14:00", timezone: "Africa/Lagos", location: "Lagos", description: "From email"};
  const suggestion = (await db.query("insert into mail_event_suggestions(connection_id,user_id,source_key,source_subject,source_sender,payload,confidence) values($1,$2,'uid-1','Meeting','sender@example.com',$3,'clear') returning id", [connection, a, JSON.stringify(mailPayload)])).rows[0].id;
  const review = (await db.query("insert into mail_event_suggestions(connection_id,user_id,source_key,source_subject,source_sender,payload,confidence) values($1,$2,'uid-2','Appointment','sender@example.com',$3,'review') returning id", [connection, a, JSON.stringify({...mailPayload,title: "Review appointment"})])).rows[0].id;
  await db.query("insert into event_drafts(user_id,payload) values($1,$2) on conflict(user_id) do update set payload=excluded.payload", [a, JSON.stringify({title: "Do not replace my manual draft"})]);
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${b}';set request.jwt.claim.role='authenticated';`);
  await assert.rejects(db.query("select * from mail_connections"), /permission denied/);
  await assert.rejects(db.query("select * from mail_processed_messages"), /permission denied/);
  await assert.rejects(db.query("select * from prelude_claim_mail_scan($1)", [connection]), /permission denied/);
  await assert.rejects(db.query("select prelude_import_mail_event($1,$2)", [suggestion, JSON.stringify(mailPayload)]), /unavailable/);
  await db.exec("reset role;set request.jwt.claim.sub='';set request.jwt.claim.role='service_role';");
  await assert.rejects(db.query("select prelude_import_mail_event($1,$2)", [review, JSON.stringify({...mailPayload,title: "Review appointment"})]), /Authentication required/);
  await assert.rejects(db.query("select prelude_import_mail_event($1,$2)", [suggestion, JSON.stringify({...mailPayload,title: "Changed by job"})]), /Authentication required/);
  await db.query("update mail_connections set auto_import=false where id=$1", [connection]);
  await assert.rejects(db.query("select prelude_import_mail_event($1,$2)", [suggestion, JSON.stringify(mailPayload)]), /Authentication required/);
  await db.query("update mail_connections set auto_import=true where id=$1", [connection]);
  const autoEvent = (await db.query("select prelude_import_mail_event($1,$2) as id", [suggestion, JSON.stringify(mailPayload)])).rows[0].id;
  assert.equal((await db.query("select payload->>'title' as title from event_drafts where user_id=$1", [a])).rows[0].title, "Do not replace my manual draft");
  assert((await db.query("select count(*)::int as count from reminders where event_id=$1", [autoEvent])).rows[0].count > 0);
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${a}';set request.jwt.claim.role='authenticated';`);
  assert.equal((await db.query("select prelude_import_mail_event($1,$2) as id", [suggestion, JSON.stringify(mailPayload)])).rows[0].id, autoEvent);
  const reviewedEvent = (await db.query("select prelude_import_mail_event($1,$2) as id", [review, JSON.stringify({...mailPayload,title: "Reviewed appointment"})])).rows[0].id;
  assert(reviewedEvent);
  await db.exec("reset role;set request.jwt.claim.sub='';set request.jwt.claim.role='service_role';");
  const duplicate = (await db.query("insert into mail_event_suggestions(connection_id,user_id,source_key,source_subject,source_sender,payload,confidence) values($1,$2,'uid-3','Meeting copy','sender@example.com',$3,'clear') returning id", [connection, a, JSON.stringify(mailPayload)])).rows[0].id;
  assert.equal((await db.query("select prelude_import_mail_event($1,$2) as id", [duplicate, JSON.stringify(mailPayload)])).rows[0].id, autoEvent);
  assert.equal((await db.query("select count(*)::int as count from reminders where event_id=$1 and automatic_key='gmail-import'", [autoEvent])).rows[0].count, 1);
  await db.query("delete from mail_connections where id=$1", [connection]);
  assert.equal((await db.query("select count(*)::int as count from mail_processed_messages where connection_id=$1", [connection])).rows[0].count, 0);
  console.log("Scan lease exclusivity, expiry recovery, ledger isolation and unique Gmail notification pass");
  assert.equal((await db.query("select count(*)::int as count from mail_event_suggestions where connection_id=$1", [connection])).rows[0].count, 0);
  assert.equal((await db.query("select count(*)::int as count from events where id=$1", [autoEvent])).rows[0].count, 1);
  console.log("Gmail credential isolation, ownership, automatic confidence, opt-out, deduplication, draft preservation and disconnect all pass");
  await db.close();
})().catch((e) => {
  console.error(e.message, e.query);
  process.exit(1);
});
