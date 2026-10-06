import {
  $, icon, esc, heading, field, mount, busy, back, errorMessage, toast,
} from "../ui.js";
import {
  listEvents, profileData, preferences, updateProfile, signedUrls,
  uploadImage, signOut, queryEventRows, unwrap,
} from "../data.js";
import {
  enableNotifications, disableNotifications, notificationState,
} from "../notifications.js";

import { emailImportSection, bindEmailImport } from "../email-import.js";

const countries = [
  ["NG", "Nigeria"], ["GH", "Ghana"], ["ZA", "South Africa"],
  ["GB", "United Kingdom"], ["US", "United States"], ["CA", "Canada"],
  ["FR", "France"], ["DE", "Germany"],
];
const portrait = (url, name) => url
  ? `<img src="${esc(url)}" alt="">`
  : esc((name || "P").slice(0, 1).toUpperCase());
const actions = (label) =>
  `<div class="form-actions"><p class="form-feedback" role="status" aria-live="polite"></p><button class="btn primary" type="submit">${esc(label)}${icon("check")}</button></div>`;


const recentMemories = (events) => {
  const past = events.filter((event) => event.status === "past")
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  return `<section class="section recent-memories" id="memories"><div class="section-head"><div><h2>Your memories</h2><p class="muted">Your most recent completed moments.</p></div></div>${past.length
    ? `<div class="stack">${past.map((event) => `<details class="glass accordion" data-memory-id="${esc(event.id)}"><summary>${icon("photo")}<div class="grow"><h3>${esc(event.title)}</h3><small>${esc(window.PreludeHomeData.eventDate(event))}</small></div></summary><div class="accordion-content"><div class="memory-preview" aria-live="polite"><p class="muted">Open this memory to see your photos and reflection.</p></div><a class="text-btn" href="event.html?id=${encodeURIComponent(event.id)}">Open full memory ${icon("arrow")}</a></div></details>`).join("")}</div>`
    : '<div class="glass pad"><p class="muted">Completed events will appear here, ready for your photos and reflections.</p></div>'}</section>`;
};

function bindMemories(root) {
  for (const detail of root.querySelectorAll("[data-memory-id]")) {
    let loaded = false, loading = false;
    detail.addEventListener("toggle", async () => {
      if (!detail.open || loaded || loading) return;
      loading = true;
      const preview = $(".memory-preview", detail);
      preview.setAttribute("aria-busy", "true");
      preview.innerHTML = '<p class="muted">Loading your memory…</p>';
      try {
        const [photos, reflection] = await Promise.all([
          queryEventRows("event_memory_photos", detail.dataset.memoryId),
          supabaseClient.from("event_reflections").select("content").eq("event_id", detail.dataset.memoryId).maybeSingle().then(unwrap),
        ]);
        const urls = await signedUrls("memory-photos", photos.map((photo) => photo.storage_path));
        preview.innerHTML = `${photos.length ? `<div class="memory-grid">${photos.map((photo) => `<div class="memory-photo">${urls[photo.storage_path] ? `<img src="${esc(urls[photo.storage_path])}" alt="Event memory" loading="lazy">` : '<small>Photo unavailable</small>'}</div>`).join("")}</div>` : ""}${reflection?.content ? `<p class="memory-reflection">${esc(reflection.content)}</p>` : '<p class="muted">No reflection saved yet.</p>'}${!photos.length ? '<p class="muted">No photos added yet.</p>' : ""}`;
        loaded = true;
      } catch {
        preview.innerHTML = '<p class="muted">We couldn’t load this memory. Close and reopen it to try again.</p>';
      } finally {
        loading = false;
        preview.setAttribute("aria-busy", "false");
      }
    });
  }
}

export async function profile(root, user) {
  const p = profileData(user), events = await listEvents(user);
  const urls = await signedUrls("avatars", [p.avatar_path]);
  const name = p.nickname || p.name || user.email?.split("@")[0] || "Your profile";
  const past = events.filter((e) => e.status === "past");
  mount(root, `${back("index.html")}${heading("Your Prelude", "Your profile", "Your plans, your moments, your preferences.")}
    <section class="glass pad profile-identity">
      <div class="row"><div class="portrait">${portrait(urls[p.avatar_path], name)}</div><div class="grow"><h2>${esc(name)}</h2><p class="muted profile-email">${esc(user.email)}</p></div></div>
      <div class="profile-actions"><a class="btn sm" href="settings.html#personal">${icon("user")}Edit profile</a></div>
      <div class="stats"><div><strong>${events.length}</strong><small>Events</small></div><div><strong>${events.length - past.length}</strong><small>Coming up</small></div><div><strong>${past.length}</strong><small>Remembered</small></div></div>
    </section>
    ${recentMemories(events)}
    <section class="glass pad section"><a class="settings-row" href="settings.html"><span class="row-icon">${icon("settings")}</span><div class="grow"><p>Settings</p><small>Profile, reminders and calendar preferences</small></div>${icon("chevron")}</a><a class="settings-row" href="settings.html#security"><span class="row-icon">${icon("lock")}</span><div class="grow"><p>Account & security</p><small>Password and sign-in options</small></div>${icon("chevron")}</a></section>
    <p class="footer-note">PRELUDE · Plan it. Live it. Remember it.</p>`);
  bindMemories(root);
}

export async function settings(root, user) {
  const p = profileData(user), prefs = preferences(user);
  const [urls, events] = await Promise.all([signedUrls("avatars", [p.avatar_path]), listEvents(user)]);
  const name = p.nickname || p.name || "P";
  let timezones;
  try {
    timezones = Intl.supportedValuesOf("timeZone");
  } catch {
    timezones = ["Africa/Lagos", "Africa/Accra", "Africa/Johannesburg", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Dubai", "Asia/Kolkata", "Australia/Sydney"];
  }
  timezones = [...new Set(["UTC", prefs.timezone, ...timezones])].sort();
  const providers = user.app_metadata?.providers || user.identities?.map((identity) => identity.provider) || [];
  const googleOnly = providers.includes("google") && !providers.includes("email");
  const row = (title, value, id, content) => `<details class="settings-detail" id="${id}"><summary><div class="grow"><p>${title}</p><small>${value}</small></div>${icon("chevron")}</summary><div class="settings-detail-body">${content}</div></details>`;
  mount(root, `${back("profile.html", "Profile")}${heading("Make it yours", "Settings", "")}
    <div class="settings-stack settings-compact">
      <section aria-labelledby="accountTitle"><h2 class="settings-label" id="accountTitle">Account</h2><div class="glass settings-group">
        ${row(esc(name), `${esc(user.email)}${providers.includes("google") ? " · Google connected" : ""}`, "personal", `<form id="personalForm" aria-label="Your profile">
          <div class="avatar-editor"><div class="portrait avatar-preview" id="avatarPreview">${portrait(urls[p.avatar_path], name)}</div><div class="grow"><label class="btn sm file-picker">${icon("photo")}Change photo<input name="avatar" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose profile photo"></label><p class="muted" id="avatarHint">JPG, PNG or WebP · up to 8 MB</p></div></div>
          <div class="stack">${field("Full name", "name", "text", p.name || "", 'required maxlength="80" autocomplete="name"')}${field("Preferred name", "nickname", "text", p.nickname || "", 'required maxlength="40" autocomplete="nickname"')}</div>${actions("Save profile")}</form>`)}
      </div></section>
      <section aria-labelledby="preferencesTitle"><h2 class="settings-label" id="preferencesTitle">Preferences</h2><div class="glass settings-group">
        ${row("Notifications", prefs.notifications ? "On" : "Off", "notifications", `<form id="notificationsForm"><label class="settings-row"><div class="grow"><p>Event & task reminders</p></div><span class="switch-control"><input name="notifications" type="checkbox" role="switch" aria-label="Event and task reminders" ${prefs.notifications ? "checked" : ""}><span aria-hidden="true"></span></span></label><p class="setting-status muted" id="notificationStatus" role="status">Checking this device…</p><button class="btn sm" type="button" id="enableThisDevice" hidden>Enable this device</button><p class="form-feedback" role="status" aria-live="polite"></p></form>`)}
        ${row("Calendar & region", `${esc(countries.find(([code]) => code === prefs.holidayCountry)?.[1] || prefs.holidayCountry)} · ${esc(prefs.timezone)}`, "region", `<form id="calendarForm" class="stack"><label>Country<select name="holidayCountry">${countries.map(([code, label]) => `<option value="${code}" ${prefs.holidayCountry === code ? "selected" : ""}>${label}</option>`).join("")}</select></label>${field("Timezone for new events", "timezone", "text", prefs.timezone, 'required list="timezones" autocomplete="off" spellcheck="false" aria-describedby="timezoneHint"')}<datalist id="timezones">${timezones.map(zone => `<option value="${esc(zone)}"></option>`).join("")}</datalist><small id="timezoneHint">Existing events keep their timezone.</small><p class="form-feedback" role="status" aria-live="polite"></p></form>`)}
      </div></section>
      <section aria-labelledby="appsTitle"><h2 class="settings-label" id="appsTitle">Connected apps</h2><div class="glass settings-group">${emailImportSection()}</div></section>
      <section id="security" aria-labelledby="securityTitle"><h2 class="settings-label" id="securityTitle">Security</h2><div class="glass settings-group"><a class="settings-row" href="reset-password.html"><div class="grow"><p>${googleOnly ? "Set an email password" : "Password"}</p></div>${icon("chevron")}</a></div></section>
      <section aria-labelledby="memoriesTitle"><h2 class="settings-label" id="memoriesTitle">Memories</h2><div class="glass settings-group">${row("Your memories", "Recent completed moments", "recent-settings-memories", recentMemories(events))}</div></section>
      <button class="text-btn danger settings-signout" id="signout" type="button">Sign out</button>
    </div>`);
  bindMemories(root);
  bindEmailImport(root);
  const revealSection = () => {
    const id = location.hash.slice(1);
    const target = id ? document.getElementById(id) : null;
    if (target?.matches("details")) target.open = true;
    if (id === "memories") $("#recent-settings-memories", root).open = true;
  };
  revealSection();
  window.addEventListener("hashchange", revealSection);
  window.addEventListener("pagehide", () => window.removeEventListener("hashchange", revealSection), {once: true});
  let previewUrl;
  let savedAvatarUrl = urls[p.avatar_path];
  let savedName = name;
  let pendingAvatarPath;
  let pendingAvatarFile;
  const forms = [$("#personalForm", root), $("#calendarForm", root), $("#notificationsForm", root)];
  const feedback = (form, message, state = "") => {
    const target = $(".form-feedback", form);
    target.textContent = message;
    target.dataset.state = state;
  };
  const beforeUnload = (event) => {
    if (forms.some((form) => form.dataset.dirty === "true" || form.dataset.saving === "true")) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", beforeUnload);
  window.addEventListener("pagehide", () => {
    window.removeEventListener("beforeunload", beforeUnload);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, { once: true });
  for (const form of [$("#personalForm", root)]) {
    const markDirty = (event) => {
      form.dataset.dirty = "true";
      if (event.target.name === "avatar" && !event.target.validity.valid) return;
      feedback(form, "Unsaved changes");
    };
    form.addEventListener("input", markDirty);
    form.addEventListener("change", markDirty);
  }
  const bindSave = (id, saving, work) => {
    const form = $(id, root), button = $("button[type=submit]", form);
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (form.dataset.saving === "true" || !form.reportValidity()) return;
      const fd = new FormData(form);
      const controls = [...form.querySelectorAll("input, select, button")].map((control) => [control, control.disabled]);
      const original = button.innerHTML;
      form.dataset.saving = "true";
      form.setAttribute("aria-busy", "true");
      controls.forEach(([control]) => { control.disabled = true; });
      button.textContent = saving;
      feedback(form, saving);
      try {
        const message = await work(fd, form);
        form.dataset.dirty = "false";
        feedback(form, message, "success");
      } catch (error) {
        feedback(form, errorMessage(error), "error");
      } finally {
        form.dataset.saving = "false";
        form.setAttribute("aria-busy", "false");
        controls.forEach(([control, disabled]) => { control.disabled = disabled; });
        button.innerHTML = original;
      }
    };
  };
  const avatarInput = $("[name=avatar]", root);
  avatarInput.onchange = () => {
    avatarInput.setCustomValidity("");
    const file = avatarInput.files[0];
    if (file && (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024)) {
      avatarInput.setCustomValidity("Choose a JPG, PNG or WebP image up to 8 MB.");
      feedback($("#personalForm", root), "Choose a JPG, PNG or WebP image up to 8 MB.", "error");
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = file ? URL.createObjectURL(file) : undefined;
    $("#avatarPreview", root).innerHTML = portrait(previewUrl || savedAvatarUrl, savedName);
    $("#avatarHint", root).textContent = file ? `${file.name} · Save profile to apply` : "JPG, PNG or WebP · up to 8 MB";
  };
  bindSave("#personalForm", "Saving profile…", async (fd) => {
    const fullName = fd.get("name").trim(), nickname = fd.get("nickname").trim();
    if (!fullName || !nickname) throw { friendly: "Enter your full name and preferred name." };
    const file = avatarInput.files[0];
    if (file && (file !== pendingAvatarFile || !pendingAvatarPath)) {
      pendingAvatarPath = await uploadImage(user, "avatars", file);
      pendingAvatarFile = file;
    }
    const avatar_path = file ? pendingAvatarPath : profileData(user).avatar_path;
    await updateProfile(user, { name: fullName, nickname, avatar_path });
    const avatarUrls = await signedUrls("avatars", [avatar_path]);
    const url = avatarUrls[avatar_path] || previewUrl;
    savedAvatarUrl = url;
    savedName = nickname;
    $("#avatarPreview", root).innerHTML = portrait(url, nickname);
    const headerAvatar = $(".topbar .avatar");
    if (headerAvatar) headerAvatar.innerHTML = portrait(url, nickname);
    $("[name=name]", root).value = fullName;
    $("[name=nickname]", root).value = nickname;
    $("#personal summary p", root).textContent = nickname;
    toast("Profile saved");
    avatarInput.value = "";
    pendingAvatarPath = pendingAvatarFile = undefined;
    $("#avatarHint", root).textContent = "JPG, PNG or WebP · up to 8 MB";
    return "Your profile is saved.";
  });
  const calendarForm = $("#calendarForm", root);
  calendarForm.onsubmit = event => event.preventDefault();
  for (const input of calendarForm.querySelectorAll("input,select")) input.onchange = async () => {
    if (calendarForm.dataset.saving === "true") return;
    const key = input.name, previous = preferences(user)[key];
    let value = input.value.trim();
    try {
      if (key === "timezone") {
        if (value !== "UTC" && !value.includes("/")) throw new Error();
        value = new Intl.DateTimeFormat("en", {timeZone: value}).resolvedOptions().timeZone;
      } else if (!countries.some(([code]) => code === value)) throw new Error();
    } catch {
      input.value = previous;
      feedback(calendarForm, "Choose a country or timezone from the list.", "error");
      return;
    }
    const controls = [...calendarForm.querySelectorAll("input,select")];
    controls.forEach(control => { control.disabled = true; });
    calendarForm.dataset.saving = "true";
    feedback(calendarForm, "Saving…");
    try {
      await updateProfile(user, {preferences: {[key]: value}});
      input.value = value;
      const saved = preferences(user);
      $("#region summary small", root).textContent = `${countries.find(([code]) => code === saved.holidayCountry)?.[1] || saved.holidayCountry} · ${saved.timezone}`;
      feedback(calendarForm, "Saved", "success");
    } catch (error) {
      input.value = previous;
      feedback(calendarForm, errorMessage(error), "error");
    } finally {
      calendarForm.dataset.saving = "false";
      controls.forEach(control => { control.disabled = false; });
    }
  };
  const notificationsForm = $("#notificationsForm", root);
  const toggle = $("[name=notifications]", notificationsForm);
  const deviceButton = $("#enableThisDevice", root);
  let checking = 0;
  async function refreshDeviceStatus() {
    const check = ++checking;
    try {
      const state = await notificationState(user);
      if (check !== checking || !root.isConnected) return;
      const status = $("#notificationStatus", root);
      status.textContent = !state.supported
        ? "Notifications aren’t supported in this browser."
        : state.permission === "denied"
          ? "Blocked by your browser. Allow notifications in this site’s browser settings to receive reminders here."
          : state.enabled
            ? "Ready on this device."
            : state.accountEnabled
              ? "Reminders are on for your account. Enable this device to receive them here."
              : "Turn on reminders to allow notifications on this device.";
      $("#notifications summary small", root).textContent = !state.accountEnabled ? "Off" : state.enabled ? "On" : "On · device setup needed";
      deviceButton.hidden = !state.accountEnabled || state.enabled || !state.supported;
      deviceButton.textContent = state.permission === "denied" ? "Check browser permission" : "Enable on this device";
    } catch {
      if (check !== checking || !root.isConnected) return;
      $("#notificationStatus", root).textContent = "Couldn’t check this device. Try again.";
      deviceButton.hidden = !preferences(user).notifications;
      deviceButton.textContent = "Retry device setup";
    }
  }
  notificationsForm.onsubmit = event => event.preventDefault();
  toggle.onchange = async () => {
    if (notificationsForm.dataset.saving === "true") return;
    notificationsForm.dataset.saving = "true";
    toggle.disabled = deviceButton.disabled = true;
    try {
      if (toggle.checked) await enableNotifications(user);
      else await disableNotifications(user);
      feedback(notificationsForm, "Saved", "success");
    } catch (error) {
      feedback(notificationsForm, errorMessage(error), "error");
    } finally {
      toggle.checked = Boolean(preferences(user).notifications);
      notificationsForm.dataset.saving = "false";
      toggle.disabled = deviceButton.disabled = false;
      await refreshDeviceStatus();
    }
  };
  deviceButton.onclick = busy(deviceButton, async () => {
    if (notificationsForm.dataset.saving === "true") return;
    toggle.disabled = true;
    notificationsForm.dataset.saving = "true";
    try {
      await enableNotifications(user);
      toggle.checked = true;
      notificationsForm.dataset.dirty = "false";
      feedback(notificationsForm, "This device is ready for reminders.", "success");
    } finally {
      toggle.disabled = false;
      notificationsForm.dataset.saving = "false";
      await refreshDeviceStatus();
    }
  }, "Setting up reminders…");
  void refreshDeviceStatus();
  $("#signout", root).onclick = busy($("#signout", root), async () => {
    if (forms.some((form) => form.dataset.saving === "true"))
      throw { friendly: "Wait for your settings to finish saving, then sign out." };
    await signOut();
  }, "Signing out…");
}
