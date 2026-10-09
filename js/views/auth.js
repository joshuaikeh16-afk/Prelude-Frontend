import {
  $,
  icon,
  esc,
  heading,
  field,
  mount,
  toast,
  errorMessage,
  back,
} from "../ui.js";
import {
  api,
  unwrap,
  updateProfile,
  profileData,
  uploadImage,
  preferences,
} from "../data.js";
import { authDestination, authMessage } from "../auth-session.js";
import { googlePermissionOptions } from "../gmail-permission.js";
const brand = `<a class="wordmark" href="signin.html"><span class="mark">${icon("spark")}</span>PRELUDE</a>`;
const googleButton = `<button type="button" class="btn full auth-provider" id="google"><svg class="google-mark" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.61 4.61 0 0 1-2 3.03v2.52h3.24c1.9-1.75 2.98-4.33 2.98-7.38Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.39l-3.24-2.52c-.9.6-2.04.97-3.38.97-2.6 0-4.8-1.76-5.59-4.12H3.07v2.6A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.41 13.94a6 6 0 0 1 0-3.88v-2.6H3.07a10 10 0 0 0 0 9.08l3.34-2.6Z"/><path fill="#EA4335" d="M12 5.94c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.93 5.46l3.34 2.6C7.2 7.7 9.4 5.94 12 5.94Z"/></svg>Continue with Google</button>`;
const passwordField = (label, name, autocomplete, value = "") => `<div class="password-field">${field(label, name, "password", value, `id="${name}" autocomplete="${autocomplete}" ${autocomplete === "new-password" ? 'minlength="8" maxlength="128"' : ""} required`)}<button type="button" class="text-btn password-toggle" data-toggle-password="${name}" aria-controls="${name}" aria-pressed="false">Show ${label.toLowerCase()}</button></div>`;
function bindPasswordToggles(root) {
  root.querySelectorAll("[data-toggle-password]").forEach((button) => {
    button.onclick = () => {
      const input = document.getElementById(button.dataset.togglePassword);
      const visible = input.type === "password";
      input.type = visible ? "text" : "password";
      button.setAttribute("aria-pressed", String(visible));
      button.textContent = `${visible ? "Hide" : "Show"} ${input.name === "confirm" ? "confirm password" : input.name === "password" ? "password" : "new password"}`;
    };
  });
}
function pending(form, label) {
  if (form.dataset.pending) return null;
  form.dataset.pending = "true";
  form.setAttribute("aria-busy", "true");
  const buttons = [...form.querySelectorAll("button")].map((button) => ({ button, disabled: button.disabled }));
  const submit = form.querySelector('button:not([type="button"]), button[type="submit"]');
  const original = submit?.innerHTML;
  buttons.forEach(({ button }) => { button.disabled = true; });
  if (submit) submit.textContent = label;
  return () => {
    delete form.dataset.pending;
    form.setAttribute("aria-busy", "false");
    buttons.forEach(({ button, disabled }) => { button.disabled = disabled; });
    if (submit) submit.innerHTML = original;
  };
}
const steps = [
  [
    "Plan it.",
    "Give every meaningful moment the preparation it deserves. One event. A clear intention. A little more peace of mind.",
    "calendar",
  ],
  [
    "Live it.",
    "Arrive ready. Keep your plans, details and directions together, so you can be present for the moment.",
    "spark",
  ],
  [
    "Remember it.",
    "Keep the preparation, the photographs and the things that made it yours. Your moments deserve a place to stay.",
    "photo",
  ],
];
export function intro(root) {
  let step = 0;
  function render() {
    const [title, text, symbol] = steps[step];
    mount(
      root,
      `<div class="auth-shell">${brand}<div class="intro-visual"><div class="orb"></div><div class="orbit"></div><div class="intro-symbol">${icon(symbol)}</div></div><div class="intro-text"><span class="eyebrow">${step === 0 ? "A little preparation. A better moment." : step === 1 ? "Make space for the moment." : "Keep what matters."}</span><h1>${title}</h1><p>${text}</p></div><div class="intro-dots" aria-label="Step ${step + 1} of 3">${steps.map((_, i) => `<span class="${i === step ? "active" : ""}"></span>`).join("")}</div><button class="btn primary full" id="introNext">${step === 2 ? "Let’s begin" : "Continue"}${icon("arrow")}</button>${step ? '<button class="text-btn full" id="introBack">Back</button>' : ""}<p class="footer-note">Plan it. Live it. Remember it.</p></div>`,
    );
    $("#introNext").onclick = () => {
      if (step < 2) {
        step++;
        render();
      } else {
        localStorage.setItem("prelude-intro-done", "1");
        location.replace("signin.html");
      }
    };
    if (step)
      $("#introBack").onclick = () => {
        step--;
        render();
      };
  }
  render();
}
export function signin(root, initialError = "") {
  mount(
    root,
    `<div class="auth-shell">${brand}${heading("Welcome back", "Your next moment awaits.", "Sign in and pick up where you left off.")}<div class="glass"><form id="signinForm" class="stack">${field("Email address", "email", "email", "", 'autocomplete="email" required maxlength="254"')}${passwordField("Password", "password", "current-password")}<p class="form-error" id="authError" role="alert">${esc(initialError)}</p><button type="submit" class="btn primary full">Sign in${icon("arrow")}</button></form><a class="text-btn" href="reset-password.html">Forgot your password?</a><div class="divider">or</div>${googleButton}</div><p class="auth-foot">New to Prelude? <a href="signup.html">Create an account</a></p></div>`,
  );
  bindPasswordToggles(root);
  $("#signinForm").onsubmit = async (e) => {
    e.preventDefault();
    const done = pending(e.currentTarget, "Signing in…");
    if (!done) return;
    $("#authError").textContent = "";
    try {
      const fd = new FormData(e.currentTarget);
      const data = unwrap(
        await supabaseClient.auth.signInWithPassword({
          email: fd.get("email").trim(),
          password: fd.get("password"),
        }),
      );
      location.replace(authDestination(data.user));
    } catch (error) {
      $("#authError").textContent = authMessage(error, "We couldn’t sign you in. Check your email and password, then try again.");
    } finally {
      done();
    }
  };
  $("#google").onclick = google;
}
export async function google(event) {
  const button = event?.currentTarget || $("#google");
  if (button?.disabled) return;
  const label = button?.innerHTML;
  if (button) { button.disabled = true; button.textContent = "Opening Google…"; }
  const errorTarget = $("#authError");
  if (errorTarget) errorTarget.textContent = "";
  try {
    const data = unwrap(
      await supabaseClient.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: new URL("signup.html", location.href).href,
          skipBrowserRedirect: true,
          ...googlePermissionOptions(Boolean($("#googleGmailPermission")?.checked)),
        },
      }),
    );
    if (!data?.url) throw new Error("Missing OAuth destination");
    location.assign(data.url);
  } catch (e) {
    const message = authMessage(e, "Google sign-in couldn’t start. Try again or sign in with email.");
    if (errorTarget) errorTarget.textContent = message;
    else toast(message);
  } finally {
    if (button?.isConnected) { button.disabled = false; button.innerHTML = label; }
  }
}
export function signup(root) {
  let credentials = null, proof = null, step = 0, cooldownUntil = 0;
  let interval, sending = false, creating = false, accountCreated = false;
  const draft = { email: "", password: "", confirm: "", name: "", nickname: "" };
  const error = (text) => { $("#authError").textContent = text; };
  const status = (text) => { $("#authStatus").textContent = text; };
  function rememberFields() {
    const form = $("#signupForm");
    if (!form) return;
    for (const [key, value] of new FormData(form)) if (key in draft) draft[key] = value;
  }
  function updateResend() {
    const button = $("#resend");
    if (!button) return;
    const seconds = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
    button.disabled = sending || seconds > 0;
    button.textContent = sending ? "Sending code…" : seconds ? `Resend in ${seconds}s` : "Resend code";
  }
  async function sendCode() {
    if (sending) return false;
    sending = true;
    updateResend();
    try {
      await api("/api/email/send", { method: "POST", body: { email: credentials.email } });
      cooldownUntil = Date.now() + 60000;
      return true;
    } finally {
      sending = false;
      updateResend();
    }
  }
  function render() {
    clearInterval(interval);
    mount(root, `<div class="auth-shell">${brand}<div class="stepper" aria-label="Step ${step + 1} of 3">${[0, 1, 2].map((i) => `<span class="${i <= step ? "done" : ""}"></span>`).join("")}</div><div class="auth-step-names"><span ${step === 0 ? 'aria-current="step"' : ""}>Account</span><span ${step === 1 ? 'aria-current="step"' : ""}>Verify email</span><span ${step === 2 ? 'aria-current="step"' : ""}>Your profile</span></div>${heading("Create your account", step === 0 ? "Make room for what matters." : step === 1 ? "Check your inbox." : "Make yourself at home.", step === 0 ? "Your events, preparation and memories in one place." : step === 1 ? `Enter the six-digit code sent to ${credentials.email}. It expires in 10 minutes.` : "Tell us your name and what you like to be called.")}<div class="glass"><form id="signupForm" class="stack">${step === 0 ? `${field("Email address", "email", "email", draft.email, 'autocomplete="email" required maxlength="254"')}${passwordField("Password", "password", "new-password", draft.password)}<small>Use at least 8 characters.</small>${passwordField("Confirm password", "confirm", "new-password", draft.confirm)}` : step === 1 ? field("Verification code", "code", "text", "", 'inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required') : `${field("Full name", "name", "text", draft.name, 'autocomplete="name" maxlength="80" required')}${field("Preferred name", "nickname", "text", draft.nickname, 'autocomplete="nickname" maxlength="40" required')}`}<p class="form-error" id="authError" role="alert"></p><p class="auth-status" id="authStatus" role="status"></p><button type="submit" class="btn primary full">${step === 0 ? "Send verification code" : step === 1 ? "Verify email" : accountCreated ? "Continue to Prelude" : "Create account"}${icon("arrow")}</button></form>${step === 0 ? `<div class="divider">or</div>${googleButton}` : step === 1 ? '<button type="button" class="text-btn" id="resend">Resend code</button><button type="button" class="text-btn" id="changeEmail">Change email</button>' : !accountCreated ? '<button type="button" class="text-btn" id="verifyAgain">Verify email again</button>' : ""}</div><p class="auth-foot">Already have an account? <a href="signin.html">Sign in</a></p></div>`);
    $("#signupForm").onsubmit = submit;
    bindPasswordToggles(root);
    if (!step) $("#google").onclick = google;
    if (step === 2 && !accountCreated) $("#verifyAgain").onclick = async () => {
      if (creating || sending) return;
      rememberFields();
      const button = $("#verifyAgain");
      button.disabled = true;
      error("");
      try {
        if (!(await sendCode())) return;
        proof = null;
        step = 1;
        render();
      } catch (e) { error(authMessage(e)); }
      finally { if (button.isConnected) button.disabled = false; }
    };
    if (step === 1) {
      $("#changeEmail").onclick = () => {
        if (sending || creating) return;
        proof = null;
        step = 0;
        render();
      };
      $("#resend").onclick = async () => {
        if (sending || creating || Date.now() < cooldownUntil) return;
        error("");
        status("");
        try { if (await sendCode()) status("A new code is on its way. Use the latest email."); }
        catch (e) { error(authMessage(e)); }
      };
      updateResend();
      interval = setInterval(updateResend, 1000);
    }
    $("#signupForm input")?.focus({ preventScroll: true });
  }
  async function submit(e) {
    e.preventDefault();
    if (creating || sending) return;
    const done = pending(e.currentTarget, step === 0 ? "Sending code…" : step === 1 ? "Verifying email…" : accountCreated ? "Signing in…" : "Creating account…");
    if (!done) return;
    creating = true;
    rememberFields();
    error("");
    status("");
    try {
      const fd = new FormData(e.currentTarget);
      if (step === 0) {
        if (draft.password !== draft.confirm) throw { friendly: "Your passwords don’t match." };
        credentials = { email: draft.email.trim().toLowerCase(), password: draft.password };
        await sendCode();
        proof = null;
        step = 1;
        render();
      } else if (step === 1) {
        const result = await api("/api/email/verify", { method: "POST", body: { email: credentials.email, code: String(fd.get("code")).trim() } });
        proof = result.verificationToken;
        if (!proof) throw { friendly: "Verification could not be completed. Request a new code." };
        step = 2;
        render();
      } else {
        if (!draft.name.trim() || !draft.nickname.trim()) throw { friendly: "Enter your full name and preferred name." };
        if (!accountCreated) {
          await api("/api/auth/signup", { method: "POST", body: { ...credentials, name: draft.name.trim(), nickname: draft.nickname.trim(), verificationToken: proof } });
          accountCreated = true;
          proof = null;
        }
        const result = await supabaseClient.auth.signInWithPassword(credentials);
        if (result.error) {
          render();
          throw { friendly: "Your account is ready, but we couldn’t sign you in. Select Continue to Prelude to try again, or use Sign in below." };
        }
        credentials = null;
        draft.password = draft.confirm = "";
        clearInterval(interval);
        sessionStorage.setItem("prelude-flash", "Your account is ready. Welcome to Prelude.");
        location.replace("index.html");
      }
    } catch (e) { error(authMessage(e)); }
    finally { creating = false; done(); }
  }
  window.addEventListener("pagehide", () => clearInterval(interval), { once: true });
  render();
}
export function profileSetup(root, user) {
  const p = profileData(user);
  let previewUrl = null;
  mount(root, `<div class="auth-shell">${brand}${heading("One last thing", "Make yourself at home.", "Choose the name you’ll see around Prelude.")}<form class="glass stack" id="setup">${field("Full name", "name", "text", p.name || user.user_metadata?.full_name || "", 'required maxlength="80" autocomplete="name"')}${field("Preferred name", "nickname", "text", p.nickname || "", 'required maxlength="40" autocomplete="nickname"')}<label>Profile picture <small>Optional · JPG, PNG or WebP · Up to 8 MB</small><input type="file" name="photo" accept="image/jpeg,image/png,image/webp"></label><img class="avatar avatar-upload-preview" id="setupPreview" alt="Your selected profile picture" hidden><p id="authError" class="form-error" role="alert"></p><button type="submit" class="btn primary full">Continue to Prelude${icon("arrow")}</button></form><p class="auth-foot">Signed in as ${esc(user.email || "your Google account")}<br><button class="text-btn" id="switchAccount">Use another account</button></p></div>`);
  $('input[name="photo"]', root).onchange = (e) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const file = e.target.files?.[0], preview = $("#setupPreview");
    preview.hidden = true;
    $("#authError").textContent = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) {
      $("#authError").textContent = "Choose a JPG, PNG or WebP image smaller than 8 MB.";
      e.target.value = "";
      return;
    }
    previewUrl = URL.createObjectURL(file);
    preview.src = previewUrl;
    preview.hidden = false;
  };
  $("#switchAccount").onclick = async (e) => {
    const button = e.currentTarget;
    button.disabled = true;
    try {
      unwrap(await supabaseClient.auth.signOut());
      sessionStorage.removeItem("prelude-recovery");
      location.replace("signin.html");
    } catch (error) { $("#authError").textContent = authMessage(error); }
    finally { button.disabled = false; }
  };
  $("#setup").onsubmit = async (e) => {
    e.preventDefault();
    const done = pending(e.currentTarget, "Saving your profile…");
    if (!done) return;
    $("#authError").textContent = "";
    try {
      const fd = new FormData(e.currentTarget), name = fd.get("name").trim(), nickname = fd.get("nickname").trim();
      if (!name || !nickname) throw { friendly: "Enter your full name and preferred name." };
      const file = fd.get("photo");
      const avatar_path = file?.size ? await uploadImage(user, "avatars", file) : p.avatar_path;
      await updateProfile(user, { name, nickname, avatar_path, complete: true, walkthrough_completed: Boolean(p.walkthrough_completed), preferences: preferences(user) });
      sessionStorage.setItem("prelude-flash", "Your profile is ready. Welcome to Prelude.");
      location.replace("index.html");
    } catch (error) { $("#authError").textContent = authMessage(error); }
    finally { done(); }
  };
  window.addEventListener("pagehide", () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, { once: true });
}
export async function resetPassword(root, initialError = "") {
  let session = null;
  try { session = unwrap(await supabaseClient.auth.getSession()).session; }
  catch { initialError ||= "We couldn’t check this reset link. Check your connection and try again."; }
  let savedRecovery;
  try { savedRecovery = JSON.parse(sessionStorage.getItem("prelude-recovery") || "null"); }
  catch { sessionStorage.removeItem("prelude-recovery"); }
  const recovery = !initialError && Boolean(session?.user) && (window.PreludeConfig.passwordRecovery || (savedRecovery?.userId === session.user.id && savedRecovery.expires > Date.now()));
  if (!recovery) sessionStorage.removeItem("prelude-recovery");
  let cooldownUntil = 0, interval;
  mount(root, `<div class="auth-shell">${brand}${heading("Account security", recovery ? "Choose a new password." : "Reset your password.", recovery ? "Use at least 8 characters for your new password." : "Enter your account email and we’ll send you a reset link.")}<form class="glass stack" id="reset">${recovery ? `${passwordField("New password", "password", "new-password")}${passwordField("Confirm password", "confirm", "new-password")}` : field("Email address", "email", "email", "", 'required maxlength="254" autocomplete="email"')}<p class="form-error" id="authError" role="alert">${esc(initialError)}</p><p class="auth-status" id="authStatus" role="status"></p><button type="submit" class="btn primary">${recovery ? "Save password" : "Send reset link"}</button></form><p class="auth-foot">${session?.user ? back("settings.html#security", "Back to Settings") : back("signin.html", "Back to sign in")}</p></div>`);
  bindPasswordToggles(root);
  function tick() {
    const button = $('#reset button[type="submit"]');
    if (!button || recovery) return;
    const seconds = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
    button.disabled = seconds > 0 || Boolean($("#reset").dataset.pending);
    button.textContent = seconds ? `Send another link in ${seconds}s` : "Send reset link";
    if (!seconds) clearInterval(interval);
  }
  $("#reset").onsubmit = async (e) => {
    e.preventDefault();
    if (Date.now() < cooldownUntil) return;
    const done = pending(e.currentTarget, recovery ? "Saving password…" : "Sending reset link…");
    if (!done) return;
    $("#authError").textContent = "";
    $("#authStatus").textContent = "";
    try {
      const fd = new FormData(e.currentTarget);
      if (recovery) {
        if (fd.get("password") !== fd.get("confirm")) throw { friendly: "Your passwords don’t match." };
        unwrap(await supabaseClient.auth.updateUser({ password: fd.get("password") }));
        sessionStorage.removeItem("prelude-recovery");
        window.PreludeConfig.passwordRecovery = false;
        sessionStorage.setItem("prelude-flash", "Your password has been updated.");
        location.replace("index.html");
      } else {
        unwrap(await supabaseClient.auth.resetPasswordForEmail(fd.get("email").trim().toLowerCase(), { redirectTo: new URL("reset-password.html", location.href).href }));
        $("#authStatus").textContent = "If an account exists for this email, a reset link is on its way. Check your inbox and spam folder.";
        cooldownUntil = Date.now() + 60000;
        interval = setInterval(tick, 1000);
      }
    } catch (error) { $("#authError").textContent = authMessage(error); }
    finally { done(); if (!recovery) tick(); }
  };
  window.addEventListener("pagehide", () => clearInterval(interval), { once: true });
}
