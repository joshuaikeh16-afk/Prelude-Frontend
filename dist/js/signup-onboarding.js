const introScreen = document.getElementById("introScreen");
const accountScreen = document.getElementById("accountScreen");
const phoneScreen = document.getElementById("phoneScreen");
const profileScreen = document.getElementById("profileScreen");
const completeScreen = document.getElementById("completeScreen");

const introContinue = document.getElementById("introContinue");
const backToIntro = document.getElementById("backToIntro");
const backToAccount = document.getElementById("backToAccount");
const backToPhone = document.getElementById("backToPhone");

const createAccountButton =
  document.getElementById("createAccountButton");

const accountForm =
  document.getElementById("signUpForm");

const phoneInput =
  document.getElementById("signUpPhone");

const sendOtpButton =
  document.getElementById("sendOtpButton");

const otpArea =
  document.getElementById("otpArea");

const otpInput =
  document.getElementById("signUpOtp");

const verifyPhoneButton =
  document.getElementById("verifyPhoneButton");

const resendOtpButton =
  document.getElementById("resendOtpButton");

const profileForm =
  document.getElementById("profileForm");

const enterDashboard =
  document.getElementById("enterDashboard");

const accountError =
  document.getElementById("signUpError");

const phoneError =
  document.getElementById("phoneError");

const profileError =
  document.getElementById("profileError");

let currentStep = 0;

let otpId = null;
let normalizedPhone = null;
let verificationToken = null;
let phoneVerified = false;

function showScreen(screen) {
  [
    introScreen,
    accountScreen,
    phoneScreen,
    profileScreen,
    completeScreen
  ].forEach((item) => {
    item.classList.remove("is-active");
  });

  screen.classList.add("is-active");

  currentStep = {
    [introScreen.id]: 0,
    [accountScreen.id]: 1,
    [phoneScreen.id]: 2,
    [profileScreen.id]: 3,
    [completeScreen.id]: 4
  }[screen.id];
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
    throw new Error(
      data.error || "Unable to send verification code."
    );
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
    throw new Error(
      data.error || "Invalid verification code."
    );
  }

  return data;
}

async function createAccount() {
  const email =
    document.getElementById("signUpEmail").value.trim();

  const password =
    document.getElementById("signUpPassword").value;

  const confirm =
    document.getElementById("signUpConfirm").value;

  if (password !== confirm) {
    accountError.textContent =
      "Passwords do not match.";
    return;
  }

  if (password.length < 8) {
    accountError.textContent =
      "Password must be at least 8 characters.";
    return;
  }

  accountError.textContent = "";

  createAccountButton.disabled = true;
  createAccountButton.textContent = "Continue...";

  /*
   * We do not create the account yet.
   * Step 1 only collects the account credentials.
   * Actual account creation happens after phone verification
   * and profile setup.
   */

  sessionStorage.setItem(
    "prelude_signup_email",
    email
  );

  sessionStorage.setItem(
    "prelude_signup_password",
    password
  );

  createAccountButton.disabled = false;
  createAccountButton.innerHTML =
    'Create account <span>→</span>';

  showScreen(phoneScreen);
}

introContinue.addEventListener("click", () => {
  showScreen(accountScreen);
});

backToIntro.addEventListener("click", () => {
  showScreen(introScreen);
});

backToAccount.addEventListener("click", () => {
  showScreen(accountScreen);
});

backToPhone.addEventListener("click", () => {
  showScreen(phoneScreen);
});

accountForm.addEventListener("submit", (event) => {
  event.preventDefault();
  createAccount();
});

sendOtpButton.addEventListener("click", async () => {
  phoneError.textContent = "";

  try {
    normalizedPhone = normalizePhone(
      phoneInput.value
    );

    if (!/^\+\d{10,15}$/.test(normalizedPhone)) {
      phoneError.textContent =
        "Enter a valid phone number with country code.";
      return;
    }

    sendOtpButton.disabled = true;
    sendOtpButton.textContent = "Sending...";

    const result =
      await sendPhoneOtp(normalizedPhone);

    otpId = result.otpId;

    otpArea.hidden = false;
    phoneInput.readOnly = true;

    sendOtpButton.hidden = true;

    otpInput.focus();
  } catch (error) {
    phoneError.textContent =
      error.message ||
      "Unable to send verification code.";
  } finally {
    if (!otpId) {
      sendOtpButton.disabled = false;
      sendOtpButton.innerHTML =
        'Send verification code <span>→</span>';
    }
  }
});

verifyPhoneButton.addEventListener(
  "click",
  async () => {
    phoneError.textContent = "";

    const code = otpInput.value.trim();

    if (!/^\d{6}$/.test(code)) {
      phoneError.textContent =
        "Enter the 6-digit verification code.";
      return;
    }

    verifyPhoneButton.disabled = true;
    verifyPhoneButton.textContent =
      "Verifying...";

    try {
      const result =
        await verifyPhoneOtp(
          otpId,
          code,
          normalizedPhone
        );

      if (!result.success || !result.verificationToken) {
        throw new Error(
          "Phone verification failed."
        );
      }

      verificationToken =
        result.verificationToken;

      phoneVerified = true;

      sessionStorage.setItem(
        "prelude_phone",
        normalizedPhone
      );

      sessionStorage.setItem(
        "prelude_verification_token",
        verificationToken
      );

      const verifiedMessage =
        document.getElementById("phoneVerified");

      verifiedMessage.hidden = false;
      otpArea.hidden = true;

      setTimeout(() => {
        showScreen(profileScreen);
      }, 450);

    } catch (error) {
      phoneError.textContent =
        error.message ||
        "Invalid verification code.";

      verifyPhoneButton.disabled = false;
      verifyPhoneButton.textContent =
        "Verify phone";
    }
  }
);

resendOtpButton.addEventListener(
  "click",
  async () => {
    otpId = null;
    otpInput.value = "";

    sendOtpButton.hidden = false;
    sendOtpButton.disabled = true;
    sendOtpButton.textContent = "Sending...";

    phoneError.textContent = "";

    try {
      const result =
        await sendPhoneOtp(normalizedPhone);

      otpId = result.otpId;

      phoneError.textContent =
        "A new verification code was sent.";

    } catch (error) {
      phoneError.textContent =
        error.message ||
        "Unable to resend verification code.";
    } finally {
      sendOtpButton.hidden = true;
    }
  }
);

profileForm.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    profileError.textContent = "";

    if (!phoneVerified || !verificationToken) {
      profileError.textContent =
        "Please verify your phone number first.";
      return;
    }

    const name =
      document.getElementById("signUpName").value.trim();

    const nickname =
      document.getElementById("signUpNickname").value.trim();

    if (!name || !nickname) {
      profileError.textContent =
        "Please complete both fields.";
      return;
    }

    const email =
      sessionStorage.getItem(
        "prelude_signup_email"
      );

    const password =
      sessionStorage.getItem(
        "prelude_signup_password"
      );

    if (!email || !password) {
      profileError.textContent =
        "Your signup session expired. Please start again.";
      return;
    }

    const country =
      inferCountry(normalizedPhone);

    profileForm
      .querySelector("button[type='submit']")
      .disabled = true;

    try {
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
            name,
            phone: normalizedPhone,
            country,
            verificationToken
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
          "Unable to create your account."
        );
      }

      sessionStorage.removeItem(
        "prelude_signup_password"
      );

      showScreen(completeScreen);

    } catch (error) {
      profileError.textContent =
        error.message ||
        "Unable to create your account.";

      profileForm
        .querySelector("button[type='submit']")
        .disabled = false;
    }
  }
);

enterDashboard.addEventListener(
  "click",
  () => {
    window.location.href = "index.html";
  }
);

const googleButton =
  document.getElementById("googleSignUp");

if (googleButton) {
  googleButton.addEventListener(
    "click",
    async () => {
      const { error } =
        await supabaseClient.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo:
              `${window.location.origin}/signup.html`
          }
        });

      if (error) {
        accountError.textContent =
          error.message;
      }
    }
  );
}
