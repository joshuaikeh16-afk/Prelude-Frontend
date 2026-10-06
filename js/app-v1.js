import {
  $,
  icon,
  esc,
  mount,
  navigation,
  empty,
  toast,
  errorMessage,
} from "./ui.js";
import { getUser, profileData, synchronize, signedUrls } from "./data.js";
import {
  intro,
  signin,
  signup,
  profileSetup,
  resetPassword,
} from "./views/auth.js";
import { home } from "./views/home.js";
import { events } from "./views/events.js";
import { calendar } from "./views/calendar.js";
import { create } from "./views/create.js";
import { workspace } from "./views/workspace.js";
import { profile, settings } from "./views/profile.js";
import { refreshTimer } from "./timer.js";
import { initializeAuth, rememberDestination, authDestination } from "./auth-session.js";
import { finishGmailPermission } from "./gmail-permission.js";
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch((error) => {
        console.warn("Prelude service worker registration failed:", error);
      });
  });
}
const root = $("#app"),
  filename = location.pathname.split("/").pop() || "index.html",
  page = filename === "reset.html" ? "reset-password.html" : filename;
sessionStorage.removeItem("prelude_signup_password");
sessionStorage.removeItem("prelude_email_verified");
// Keep the exact page, filters and section that opened a detail screen.
document.addEventListener("click", (event) => {
  const anchor = event.target.closest("a[href]");
  if (!anchor || anchor.classList.contains("back") || anchor.hasAttribute("download")) return;
  const target = new URL(anchor.href, location.href);
  if (target.origin !== location.origin || target.pathname === location.pathname) return;
  if (["event.html", "create.html", "profile.html", "settings.html", "reset-password.html"].includes(target.pathname.split("/").pop())) {
    if (!target.searchParams.has("from")) target.searchParams.set("from", location.pathname + location.search + location.hash);
    anchor.href = target.href;
  }
}, { capture: true });
async function boot() {
  root.setAttribute("aria-busy", "true");
  // Finish callback processing before any intro/profile redirect can discard it.
  const auth = await initializeAuth();
  await finishGmailPermission(auth);
  if (auth.error && !auth.recovery)
    sessionStorage.setItem("prelude-auth-error", auth.error);
  if (page === "reset-password.html" || auth.recovery) {
    if (page !== "reset-password.html")
      history.replaceState({}, "", new URL("reset-password.html", location.href));
    await resetPassword(root, auth.error || "");
    return;
  }
  if (page === "intro.html") {
    if (localStorage.getItem("prelude-intro-done")) {
      location.replace("index.html");
      return;
    }
    intro(root);
    return;
  }
  if (!localStorage.getItem("prelude-intro-done")) {
    rememberDestination();
    location.replace("intro.html");
    return;
  }
  const callbackError = sessionStorage.getItem("prelude-auth-error");
  if (callbackError) {
    sessionStorage.removeItem("prelude-auth-error");
    signin(root, callbackError);
    return;
  }
  const user = await getUser();
  if (!user) {
    if (page === "signin.html") {
      const message = sessionStorage.getItem("prelude-auth-error") || "";
      sessionStorage.removeItem("prelude-auth-error");
      signin(root, message);
      return;
    }
    if (page === "signup.html") {
      signup(root);
      return;
    }
    rememberDestination();
    location.replace("signin.html");
    return;
  }
  const p = profileData(user);
  if (!p.complete || !p.name || !p.nickname) {
    profileSetup(root, user);
    return;
  }
  if (["signin.html", "signup.html"].includes(page)) {
    location.replace(authDestination(user));
    return;
  }
  if (!p.walkthrough_completed && page !== "index.html") {
    location.replace("index.html");
    return;
  }
  await synchronize();
  const name = p.nickname || p.name;
  const urls = await signedUrls("avatars", [p.avatar_path]);
  root.innerHTML = `<div class="app-shell"><header class="topbar"><a href="index.html"><div class="wordmark"><span class="mark">${icon("spark")}</span>PRELUDE</div><p class="subtitle">${esc(page === "index.html" ? `A little preparation, ${name}.` : "Plan it. Live it. Remember it.")}</p></a><a class="avatar" href="profile.html" aria-label="Your profile">${urls[p.avatar_path] ? `<img src="${esc(urls[p.avatar_path])}" alt="">` : esc(name.slice(0, 1).toUpperCase())}</a></header><main class="page" id="pageContent"><div class="skeleton" aria-label="Loading"></div></main>${navigation(page)}</div>`;
  const renderers = {
    "index.html": home,
    "events.html": events,
    "calendar.html": calendar,
    "create.html": create,
    "event.html": workspace,
    "profile.html": profile,
    "settings.html": settings,
    "memories.html": events,
  };
  if (
    ["goals.html", "notes.html", "schedule.html", "reminders.html"].includes(
      page,
    )
  ) {
    const id = new URLSearchParams(location.search).get("id");
    location.replace(
      id
        ? `event.html?id=${encodeURIComponent(id)}#${page.split(".")[0]}`
        : "events.html",
    );
    return;
  }
  if (page === "memories.html") {
    location.replace("events.html?view=past");
    return;
  }
  await (renderers[page] || home)($("#pageContent"), user);
  root.setAttribute("aria-busy", "false");
  const flash = sessionStorage.getItem("prelude-flash");
  if (flash) {
    sessionStorage.removeItem("prelude-flash");
    toast(flash);
  }
  refreshTimer();
  if (location.hash) {
    const section = document.getElementById(
      decodeURIComponent(location.hash.slice(1)),
    );
    if (section?.tagName === "DETAILS") section.open = true;
    section?.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "start",
    });
  }
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session?.user?.id !== user.id) {
      location.reload();
      return;
    }
    if (event === "SIGNED_OUT") {
      sessionStorage.removeItem("prelude-recovery");
      document.querySelector("#timerBar")?.remove();
      root.replaceChildren();
      location.replace("signin.html");
    }
    if (event === "PASSWORD_RECOVERY" && session?.user) {
      sessionStorage.setItem("prelude-recovery", JSON.stringify({ userId: session.user.id, expires: Date.now() + 30 * 60 * 1000 }));
      location.replace("reset-password.html");
    }
  });
}
boot().catch((error) => {
  console.warn("Prelude page failed", error?.code || error?.name);
  const target = $("#pageContent") || root;
  mount(
    target,
    empty(
      error?.code === "PRELUDE_SETUP_REQUIRED"
        ? "Event creation needs setup."
        : "Let’s try that again.",
      error?.friendly ||
        "We couldn’t load this page. Check your connection and try again.",
    ),
  );
  const button = document.createElement("button");
  button.className = "btn full";
  button.textContent = "Try again";
  button.onclick = () => location.reload();
  target.append(button);
  root.setAttribute("aria-busy", "false");
});
window.addEventListener("offline", () =>
  toast("You’re offline. Changes need a connection to save."),
);
