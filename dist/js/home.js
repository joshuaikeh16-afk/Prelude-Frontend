(function () {
  "use strict";
  const data = window.PreludeHomeData;
  const byId = (id) => document.getElementById(id);
  let hero = null;
  let loadedUserId = null;
  let loading = false;
  let loadVersion = 0;
  let pendingReload = false;

  function state(message, { error = false, empty = false } = {}) {
    byId("homeState").hidden = false;
    byId("homeStateMessage").textContent = message;
    byId("homeRetry").hidden = !error;
    byId("homeCreate").hidden = !empty;
    byId("homeHero").hidden = true;
    byId("homeUpcoming").hidden = true;
    byId("homeNotice").hidden = true;
    hero = null;
  }

  function identity(profile, user) {
    const name = [profile?.display_name, user.user_metadata?.nickname,
      user.user_metadata?.name, user.user_metadata?.full_name]
      .find((value) => typeof value === "string" && value.trim());
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    byId("homeGreeting").textContent = name ? `${greeting}, ${name.trim()}` : greeting;
    byId("homeAvatar").textContent = name ? Array.from(name.trim())[0].toUpperCase() : "◌";
  }

  function tick() {
    if (!hero) return;
    const remaining = data.countdown(hero);
    byId("homeCountdown").hidden = Boolean(remaining.status);
    byId("homeEventStatus").hidden = !remaining.status;
    byId("homeEventStatus").textContent = remaining.status || "";
    if (!remaining.status) {
      byId("homeDays").textContent = String(remaining.days).padStart(2, "0");
      byId("homeHours").textContent = String(remaining.hours).padStart(2, "0");
      byId("homeMinutes").textContent = String(remaining.minutes).padStart(2, "0");
    }
  }

  function progress(tasks) {
    const track = byId("homeProgress");
    track.hidden = tasks === null;
    if (tasks === null) {
      byId("homeProgressPercent").textContent = "—";
      byId("homeProgressLabel").textContent = "Preparation unavailable";
      byId("homeTaskSummary").textContent = "Try again to load your tasks.";
      track.removeAttribute("aria-valuenow");
      return;
    }
    const { total, completed, percent } = data.preparation(tasks);
    byId("homeProgressPercent").textContent = total ? `${percent}%` : "—";
    byId("homeProgressLabel").textContent = !total ? "Start your preparation" :
      completed === total ? "Preparation complete" : completed ? "You're making progress" : "Ready to get started";
    byId("homeTaskSummary").textContent = total ? `${completed} of ${total} tasks complete` : "No preparation tasks yet";
    byId("homeProgressFill").style.width = `${percent}%`;
    track.setAttribute("aria-valuenow", String(percent));
    track.setAttribute("aria-valuetext", byId("homeTaskSummary").textContent);
  }

  function image(container, url, eager = false) {
    container.replaceChildren();
    if (!url) return;
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    img.loading = eager ? "eager" : "lazy";
    img.decoding = "async";
    img.addEventListener("error", () => img.remove(), { once: true });
    container.appendChild(img);
  }

  function render(events, tasks, urls) {
    hero = events[0];
    byId("homeHero").href = `event.html?id=${encodeURIComponent(hero.id)}`;
    byId("homeHeroTitle").textContent = hero.title;
    byId("homeHeroDate").textContent = data.eventDate(hero);
    byId("homeHeroLocation").textContent = data.details(hero);
    byId("homeHeroPriority").hidden = !hero.is_priority;
    image(byId("homeHeroImage"), urls[hero.image_path], true);
    progress(tasks);
    tick();
    const list = byId("homeEventList");
    list.replaceChildren();
    for (const event of events.slice(1)) {
      const link = document.createElement("a");
      link.className = "event-row";
      link.href = `event.html?id=${encodeURIComponent(event.id)}`;
      const cover = document.createElement("div");
      cover.className = "mini-image";
      image(cover, urls[event.image_path]);
      const info = document.createElement("div");
      info.className = "event-row-info";
      for (const [tag, text] of [["span", data.eventDate(event, true)], ["h3", event.title], ["p", data.details(event)]]) {
        const child = document.createElement(tag);
        child.textContent = text;
        info.appendChild(child);
      }
      const arrow = document.createElement("span");
      arrow.className = "arrow";
      arrow.textContent = "›";
      arrow.setAttribute("aria-hidden", "true");
      link.append(cover, info, arrow);
      list.appendChild(link);
    }
    byId("homeState").hidden = true;
    byId("homeHero").hidden = false;
    byId("homeUpcoming").hidden = events.length < 2;
  }

  async function taskRows(eventId) {
    const rows = [];
    const pageSize = 200;
    for (let offset = 0; ; offset += pageSize) {
      const result = await supabaseClient.from("tasks").select("id,completed")
        .eq("event_id", eventId).order("id").range(offset, offset + pageSize - 1);
      if (result.error) return { data: null, error: result.error };
      rows.push(...result.data);
      if (result.data.length < pageSize) return { data: rows, error: null };
    }
  }

  async function eventRows(userId, lowerDate) {
    const rows = [];
    const pageSize = 200;
    for (let offset = 0; ; offset += pageSize) {
      const result = await supabaseClient.from("events")
        .select("id,title,date,time,timezone,location,image_path,is_priority,status")
        .eq("user_id", userId).eq("status", "upcoming").gte("date", lowerDate)
        .order("date").order("time", { nullsFirst: true }).order("id")
        .range(offset, offset + pageSize - 1);
      if (result.error) return result;
      rows.push(...result.data);
      if (result.data.length < pageSize) return { data: rows, error: null };
    }
  }

  async function mediaUrls(events, userId) {
    const paths = [...new Set(events.map((event) => event.image_path)
      .filter((path) => typeof path === "string" && path.startsWith(`${userId}/`)))];
    if (!paths.length) return {};
    try {
      const { data: signed, error } = await supabaseClient.storage.from("event-images").createSignedUrls(paths, 3600);
      if (error) return {};
      return Object.fromEntries((signed || []).filter((item) => item.signedUrl && !item.error)
        .map((item) => [item.path, item.signedUrl]));
    } catch { return {}; }
  }

  function signedOut() {
    loadVersion++;
    pendingReload = false;
    loadedUserId = null;
    state("Please sign in to see your events.");
    byId("homeEventList").replaceChildren();
    byId("homeHeroImage").replaceChildren();
    byId("homeGreeting").textContent = "Prepare for what's next.";
    byId("homeAvatar").textContent = "◌";
    window.location.replace("signin.html");
  }

  async function loadHome() {
    if (loading) return;
    loading = true;
    const version = ++loadVersion;
    byId("home").setAttribute("aria-busy", "true");
    state("Loading your events…");
    try {
      if (typeof supabaseClient === "undefined" || !data) throw new Error("Client unavailable");
      const auth = await supabaseClient.auth.getUser();
      if (version !== loadVersion) return;
      if (auth.error) {
        if (auth.error.status === 401 || auth.error.status === 403 || auth.error.name === "AuthSessionMissingError") {
          signedOut();
          return;
        }
        throw auth.error;
      }
      const user = auth.data.user;
      if (!user) { signedOut(); return; }
      loadedUserId = user.id;
      // Include all possible event-local dates around today, then filter using
      // each event's timezone. Paginate so old uncompleted events and the API
      // row limit cannot hide a user's actual next event.
      const lowerDate = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
      const [eventsResult, profileResult] = await Promise.all([
        eventRows(user.id, lowerDate),
        supabaseClient.from("profiles").select("display_name").eq("id", user.id).maybeSingle()
      ]);
      if (version !== loadVersion) return;
      if (eventsResult.error) throw eventsResult.error;
      identity(profileResult.data, user);
      const events = data.selectEvents(eventsResult.data || []);
      if (!events.length) {
        state("Nothing coming up yet. Create an event and give yourself something to prepare for.", { empty: true });
        return;
      }
      const [tasksResult, urls] = await Promise.all([taskRows(events[0].id), mediaUrls(events, user.id)]);
      if (version !== loadVersion) return;
      render(events, tasksResult.data, urls);
      if (tasksResult.error) {
        byId("homeNoticeMessage").textContent = "Your events loaded, but preparation progress is unavailable. Please try again.";
        byId("homeNotice").hidden = false;
      }
    } catch {
      if (version === loadVersion) state("We couldn't load your events. Check your connection and try again.", { error: true });
    } finally {
      loading = false;
      byId("home").setAttribute("aria-busy", "false");
      if (pendingReload) {
        pendingReload = false;
        window.setTimeout(loadHome, 0);
      }
    }
  }

  byId("homeRetry").addEventListener("click", loadHome);
  byId("homeRefresh").addEventListener("click", loadHome);
  const timer = window.setInterval(tick, 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadHome();
  });
  window.addEventListener("pageshow", (event) => { if (event.persisted) loadHome(); });
  window.addEventListener("online", loadHome);
  window.addEventListener("pagehide", (event) => { if (!event.persisted) window.clearInterval(timer); });
  if (typeof supabaseClient !== "undefined") {
    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") signedOut();
      else if (event === "SIGNED_IN" && session?.user.id !== loadedUserId) {
        loadVersion++;
        state("Loading your events…");
        identity(null, session.user);
        if (loading) pendingReload = true;
        // Defer queries until Supabase releases its auth callback lock.
        else window.setTimeout(loadHome, 0);
      }
    });
  }
  loadHome();
})();
