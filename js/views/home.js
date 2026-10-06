import { $, icon, esc, heading, mount, empty, busy, toast } from "../ui.js";
import { listEvents, queryEventRows, signedUrls, progress, profileData, updateProfile, preferences, locked } from "../data.js";
import { eventCard } from "./events.js";
import { enableNotifications, firstEventPrompt } from "../notifications.js";
export async function home(root, user) {
  const [all, draftResult] = await Promise.all([
    listEvents(user),
    supabaseClient.from("event_drafts").select("payload").eq("user_id", user.id).maybeSingle().then(r => r.error ? null : r.data).catch(() => null),
  ]);
  const selected = window.PreludeHomeData.selectEvents(all), hero = selected[0];
  const createdId = new URLSearchParams(location.search).get("created");
  const created = all.find(e => e.id === createdId);
  const draft = draftResult?.payload;
  const [tasks, images] = hero ? await Promise.all([
    queryEventRows("tasks", hero.id).catch(() => null),
    signedUrls("event-images", selected.map(e => e.image_path)),
  ]) : [[], {}];
  const p = progress(tasks || []);
  const closed = hero && locked(hero);
  const progressText = tasks === null ? "Progress temporarily unavailable." : p.total ? `${p.completed} of ${p.total} tasks completed` : "No preparation tasks yet";
  const action = closed ? "View event" : tasks === null ? "Open preparation" : p.total ? "Continue preparation" : "Add preparation";
  mount(root, `${heading("Make space for what matters", "Your next moment.")}
    ${created ? `<section class="notice creation-success" role="status"><div class="row"><span class="success-icon">${icon("check")}</span><div class="grow"><strong>${esc(created.title)} is created.</strong><p>${esc(window.PreludeHomeData.eventDate(created))}</p></div></div><a class="text-btn" href="event.html?id=${encodeURIComponent(created.id)}">Prepare this event ${icon("arrow")}</a></section>` : ""}
    ${draft?.title ? `<a class="draft-resume row" href="create.html">${icon("notes")}<div class="grow"><strong>Continue your draft</strong><small>${esc(draft.title)}</small></div>${icon("chevron")}</a>` : ""}
    <div class="home-layout"><div>${hero ? `<section class="glass hero home-hero" id="homeHero"><div class="hero-cover">${images[hero.image_path] ? `<img src="${esc(images[hero.image_path])}" alt="">` : '<div class="hero-art"></div>'}<div class="hero-meta row between"><span class="badge">${closed ? "Preparation closed" : "Coming up"}</span>${hero.is_priority ? '<span class="badge rose">Priority</span>' : ""}</div><div class="hero-title"><span class="date">${esc(window.PreludeHomeData.eventDate(hero))}</span><h2>${esc(hero.title)}</h2><p>${esc(window.PreludeHomeData.details(hero))}</p></div></div><div class="hero-bottom"><div class="countdown compact-countdown" id="homeCountdown" aria-label="Time until event"></div><div class="preparation-summary"><span>${progressText}</span>${tasks !== null && p.total ? `<strong>${p.percent}%</strong>` : ""}</div>${tasks !== null && p.total ? `<div class="progress" role="progressbar" aria-label="Preparation" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.percent}"><span style="width:${p.percent}%"></span></div>` : ""}<a class="btn primary full hero-action" href="event.html?id=${encodeURIComponent(hero.id)}${!closed && tasks !== null && !p.total ? "#goals" : ""}">${action}${icon("arrow")}</a></div></section>` : empty("What’s your next moment?", "Start with an event. Add goals, tasks and notes whenever you need them.", "create.html", "Create your first event")}</div>
    <section class="section" id="homeUpcoming"><div class="section-head"><h2>On the horizon</h2><a href="events.html">All events ${icon("arrow")}</a></div><div class="stack">${selected.length > 1 ? selected.slice(1).map(eventCard).join("") : '<p class="quiet-empty">Your upcoming events will appear here.</p>'}</div><div id="notificationBanner"></div></section></div>`);
  if (hero) {
    const tick = () => {
      if (!$("#homeCountdown")) return;
      const c = window.PreludeHomeData.countdown(hero);
      $("#homeCountdown").innerHTML = c.status ? `<span class="badge green">${esc(c.status)}</span>` : [["days", "days"], ["hours", "hrs"], ["minutes", "min"]].map(([key,label]) => `<span><b>${String(c[key]).padStart(2,"0")}</b> <small>${label}</small></span>`).join("");
    };
    tick();
    const timer = setInterval(tick, 30000);
    window.addEventListener("pagehide", () => clearInterval(timer), {once:true});
  }
  const prefs = preferences(user);
  if (all.length && !prefs.notifications && !sessionStorage.getItem("prelude-banner-dismissed")) {
    const b = $("#notificationBanner");
    b.innerHTML = `<div class="notice row reminder-invitation">${icon("bell")}<div class="grow"><strong>A reminder when it matters.</strong><p>Before your event and when a task timer ends.</p><button class="text-btn" id="enablePush">Enable reminders</button></div><button class="icon-btn" id="dismissPush" aria-label="Dismiss reminder banner">×</button></div>`;
    $("#dismissPush").onclick = () => { sessionStorage.setItem("prelude-banner-dismissed", "1"); b.replaceChildren(); };
    $("#enablePush").onclick = busy($("#enablePush"), async () => { if (await enableNotifications(user)) b.replaceChildren(); }, "Enabling…");
  }
  if (!profileData(user).walkthrough_completed) walkthrough(user);
  else if (sessionStorage.getItem("prelude-first-event")) {
    sessionStorage.removeItem("prelude-first-event");
    await firstEventPrompt(user);
  }
}
function walkthrough(user) {
  const app = $("#app");
  app.inert = true;
  let step = 0;
  const tour = [
    [
      "Your moments, at a glance.",
      "Home brings your nearest event and real preparation progress into focus. No rush. Just your next meaningful moment.",
      "#homeHero",
    ],
    [
      "A place for every event.",
      "Events keeps upcoming moments together. Switch to Past events to revisit your memories.",
      '.nav a[href="events.html"]',
    ],
    [
      "Make something worth preparing for.",
      "Create an event, set a goal and break it into tasks. Everything stays together in its Workspace.",
      ".create-nav",
    ],
    [
      "See the days ahead.",
      "Tap a calendar date for events and holidays. Hold a date to create an event for that day.",
      '.nav a[href="calendar.html"]',
    ],
  ];
  const card = document.createElement("section");
  card.className = "onboarding-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", "Welcome walkthrough");
  document.body.append(card);
  const targets = [];
  function render() {
    targets.forEach((t) => t.classList.remove("tour-target"));
    const [title, text, target] = tour[step];
    const el = $(target);
    if (el) {
      el.classList.add("tour-target");
      targets.push(el);
    }
    card.innerHTML = `<span class="eyebrow">Welcome · ${step + 1} of ${tour.length}</span><h2 class="tour-title">${title}</h2><p>${text}</p><button class="btn primary full" id="tourNext">${step === 3 ? "Make it yours" : "Continue"}${icon("arrow")}</button>`;
    $("#tourNext").focus();
    $("#tourNext").onclick = busy($("#tourNext"), async () => {
      if (step < 3) {
        step++;
        render();
      } else {
        await updateProfile(user, { walkthrough_completed: true });
        targets.forEach((t) => t.classList.remove("tour-target"));
        card.remove();
        app.inert = false;
        toast("You’re ready. Create your first moment.");
      }
    });
  }
  card.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      $("#tourNext").focus();
    }
  });
  render();
}
