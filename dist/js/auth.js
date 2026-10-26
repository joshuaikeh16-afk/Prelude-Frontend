async function signIn(email, password) {
  const { error } = await supabaseClient.auth.signInWithPassword({
    email,
    password
  });

  if (error) throw error;
}

async function signUp(
  email,
  password,
  nickname,
  phone,
  country,
  verificationToken
) {
  const response = await fetch(
    "http://localhost:3000/api/auth/signup",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        password,
        nickname,
        phone,
        country,
        verificationToken
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Unable to create your account.");
  }

  return data;
}

async function signOutUser() {
  await supabaseClient.auth.signOut();
  window.location.href = "signin.html";
}

function normalizePhone(phone) {
  let value = phone.trim().replace(/[^\d+]/g, "");

  if (value.startsWith("00")) {
    value = "+" + value.slice(2);
  }

  if (value.startsWith("0")) {
    value = "+234" + value.slice(1);
  }

  if (!value.startsWith("+")) {
    value = "+" + value;
  }

  return value;
}

function inferCountry(phone) {
  if (phone.startsWith("+234")) return "NG";
  if (phone.startsWith("+233")) return "GH";
  if (phone.startsWith("+254")) return "KE";
  if (phone.startsWith("+27")) return "ZA";
  if (phone.startsWith("+1")) return "US";
  if (phone.startsWith("+44")) return "GB";
  if (phone.startsWith("+61")) return "AU";
  if (phone.startsWith("+49")) return "DE";
  if (phone.startsWith("+33")) return "FR";
  if (phone.startsWith("+91")) return "IN";

  return null;
}

async function sendPhoneOtp(phone) {
  const response = await fetch(
    "http://localhost:3000/api/phone/send",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ phone })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Unable to send verification code.");
  }

  return data;
}

async function verifyPhoneOtp(otpId, code, phone) {
  const response = await fetch(
    "http://localhost:3000/api/phone/verify",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        otpId,
        code,
        phone
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Invalid verification code.");
  }

  return data;
}

const signInForm = document.getElementById("signInForm");

if (signInForm) {
  signInForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const errorBox = document.getElementById("signInError");
    const button = signInForm.querySelector("button[type='submit']");

    errorBox.textContent = "";
    button.disabled = true;
    button.textContent = "Signing in...";

    try {
      await signIn(
        document.getElementById("signInEmail").value.trim(),
        document.getElementById("signInPassword").value
      );

      window.location.href = "index.html";
    } catch (error) {
      errorBox.textContent = error.message || "Unable to sign in.";
      button.disabled = false;
      button.textContent = "Sign in";
    }
  });
}

const signUpForm = document.getElementById("signUpForm");

if (signUpForm) {
  let otpId = null;
  let verifiedPhone = false;
  let normalizedPhone = null;
  let verificationToken = null;

  const phoneInput = document.getElementById("signUpPhone");
  const otpSection = document.getElementById("otpSection");
  const otpInput = document.getElementById("signUpOtp");
  const verifyButton = document.getElementById("verifyPhoneButton");
  const resendButton = document.getElementById("resendOtpButton");
  const phoneVerified = document.getElementById("phoneVerified");
  const errorBox = document.getElementById("signUpError");
  const createButton = document.getElementById("createAccountButton");

  phoneInput.addEventListener("blur", () => {
    if (!phoneInput.value.trim()) return;

    try {
      phoneInput.value = normalizePhone(phoneInput.value);
    } catch {
      // Leave validation to the send button.
    }
  });

  async function sendCode() {
    errorBox.textContent = "";

    normalizedPhone = normalizePhone(phoneInput.value);

    if (!/^\+\d{10,15}$/.test(normalizedPhone)) {
      errorBox.textContent =
        "Enter a valid phone number with country code.";
      return;
    }

    try {
      resendButton.disabled = true;
      verifyButton.disabled = true;

      const result = await sendPhoneOtp(normalizedPhone);

      otpId = result.otpId;
      otpSection.hidden = false;
      otpInput.focus();

      errorBox.textContent =
        "Verification code sent. Check your phone.";

      resendButton.disabled = false;
      verifyButton.disabled = false;
    } catch (error) {
      errorBox.textContent =
        error.message || "Unable to send verification code.";

      resendButton.disabled = false;
      verifyButton.disabled = false;
    }
  }

  phoneInput.addEventListener("change", () => {
    verifiedPhone = false;
    phoneVerified.hidden = true;
    otpSection.hidden = true;
    otpId = null;
  });

  const sendOtpButton = document.createElement("button");
  sendOtpButton.type = "button";
  sendOtpButton.className = "auth-secondary";
  sendOtpButton.textContent = "Send verification code";

  phoneInput.parentElement.appendChild(sendOtpButton);

  sendOtpButton.addEventListener("click", sendCode);

  verifyButton.addEventListener("click", async () => {
    errorBox.textContent = "";

    if (!otpId) {
      errorBox.textContent = "Send a verification code first.";
      return;
    }

    const code = otpInput.value.trim();

    if (!/^\d{6}$/.test(code)) {
      errorBox.textContent = "Enter the 6-digit verification code.";
      return;
    }

    verifyButton.disabled = true;
    verifyButton.textContent = "Verifying...";

    try {
      const result = await verifyPhoneOtp(
        otpId,
        code,
        normalizedPhone
      );

      if (!result.success) {
        throw new Error("Phone verification failed.");
      }

      verifiedPhone = true;
      verificationToken = result.verificationToken;
      phoneVerified.hidden = false;
      otpSection.hidden = true;
      sendOtpButton.disabled = true;
      phoneInput.readOnly = true;

      errorBox.textContent = "";
    } catch (error) {
      errorBox.textContent =
        error.message || "Invalid verification code.";

      verifyButton.disabled = false;
      verifyButton.textContent = "Verify phone";
    }
  });

  resendButton.addEventListener("click", sendCode);

  signUpForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    errorBox.textContent = "";

    if (!verifiedPhone || !normalizedPhone) {
      errorBox.textContent =
        "Please verify your phone number first.";
      return;
    }

    const nickname =
      document.getElementById("signUpNickname").value.trim();

    const email =
      document.getElementById("signUpEmail").value.trim();

    const password =
      document.getElementById("signUpPassword").value;

    const confirm =
      document.getElementById("signUpConfirm").value;

    if (password !== confirm) {
      errorBox.textContent = "Passwords do not match.";
      return;
    }

    createButton.disabled = true;
    createButton.textContent = "Creating account...";

    try {
      const country = inferCountry(normalizedPhone);

      const data = await signUp(
        email,
        password,
        nickname,
        normalizedPhone,
        country,
        verificationToken
      );

      if (data.success) {
        errorBox.textContent =
          "Account created. Check your email to confirm your account.";

        createButton.disabled = false;
        createButton.textContent = "Create account";
      }
    } catch (error) {
      errorBox.textContent =
        error.message || "Unable to create your account.";

      createButton.disabled = false;
      createButton.textContent = "Create account";
    }
  });
}

const googleSignIn = document.getElementById("googleSignIn");
const googleSignUp = document.getElementById("googleSignUp");

async function googleAuth() {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/index.html`
    }
  });

  if (error) {
    const box =
      document.getElementById("signInError") ||
      document.getElementById("signUpError");

    if (box) box.textContent = error.message;
  }
}

if (googleSignIn) {
  googleSignIn.addEventListener("click", googleAuth);
}

if (googleSignUp) {
  googleSignUp.addEventListener("click", googleAuth);
}
