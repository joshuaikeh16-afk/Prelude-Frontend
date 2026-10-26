const signUpForm = document.getElementById("signUpForm");
const errorBox = document.getElementById("signUpError");

const accountScreen = document.getElementById("accountScreen");

const profileScreen = document.getElementById("profileScreen");
const backToEmail = document.getElementById("backToEmail");
const profileForm = document.getElementById("profileForm");

const emailScreen = document.getElementById("emailScreen");
const emailOtpInput = document.getElementById("signUpEmailOtp");
const verifyEmailButton = document.getElementById("verifyEmailButton");
const resendEmailButton = document.getElementById("resendEmailButton");
const emailError = document.getElementById("emailError");

function showScreen(screen) {
  document
    .querySelectorAll(".signup-screen")
    .forEach((item) => item.classList.remove("active"));

  screen.classList.add("active");
}

async function sendEmailOtp(email) {
  const response = await fetch(
    "http://localhost:3000/api/email/send",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email }),
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

async function verifyEmailOtp(email, code) {
  const response = await fetch(
    "http://localhost:3000/api/email/verify",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        code,
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error || "Unable to verify the code."
    );
  }

  return data;
}

async function startEmailVerification() {
  const email =
    sessionStorage.getItem("prelude_signup_email");

  if (!email) {
    emailError.textContent =
      "Your email could not be found. Please start signup again.";
    return;
  }

  emailError.textContent = "";

  try {
    await sendEmailOtp(email);
    emailOtpInput.focus();
  } catch (error) {
    emailError.textContent =
      error.message ||
      "Unable to send verification code.";
  }
}

signUpForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  errorBox.textContent = "";

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

  if (password.length < 8) {
    errorBox.textContent =
      "Password must be at least 8 characters.";
    return;
  }

  sessionStorage.setItem(
    "prelude_signup_email",
    email
  );

  sessionStorage.setItem(
    "prelude_signup_password",
    password
  );

  showScreen(emailScreen);

  await startEmailVerification();
});

async function handleEmailVerification() {
  emailError.textContent = "";

  const email =
    sessionStorage.getItem("prelude_signup_email");

  const code =
    emailOtpInput.value.trim();

  if (!email) {
    emailError.textContent =
      "Your email could not be found.";
    return;
  }

  if (!/^\d{6}$/.test(code)) {
    emailError.textContent =
      "Enter the 6-digit verification code.";
    return;
  }

  verifyEmailButton.disabled = true;
  verifyEmailButton.textContent = "Verifying...";

  try {
    const result = await verifyEmailOtp(email, code);

    if (!result.verified) {
      throw new Error(
        "The verification code is incorrect."
      );
    }

    sessionStorage.setItem(
      "prelude_email_verified",
      "true"
    );

    verifyEmailButton.textContent =
      "Email verified ✓";

    setTimeout(() => {
      showScreen(profileScreen);

      document
        .getElementById("signUpName")
        .focus();
    }, 1000);

  } catch (error) {
    emailError.textContent =
      error.message ||
      "The verification code is incorrect.";

    verifyEmailButton.disabled = false;
    verifyEmailButton.textContent =
      "Verify email";
  }
}

verifyEmailButton.addEventListener(
  "click",
  handleEmailVerification
);

resendEmailButton.addEventListener(
  "click",
  async () => {
    const email =
      sessionStorage.getItem("prelude_signup_email");

    if (!email) {
      emailError.textContent =
        "Your email could not be found.";
      return;
    }

    resendEmailButton.disabled = true;
    resendEmailButton.textContent = "Sending...";

    try {
      await sendEmailOtp(email);

      emailOtpInput.value = "";
      emailError.textContent = "";
      emailOtpInput.focus();

    } catch (error) {
      emailError.textContent =
        error.message ||
        "Unable to resend verification code.";
    }

    resendEmailButton.disabled = false;
    resendEmailButton.textContent = "Resend code";
  }
);

backToEmail.addEventListener("click", () => {
  showScreen(emailScreen);
});

profileForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const profileError =
    document.getElementById("profileError");

  const name =
    document.getElementById("signUpName").value.trim();

  const preferredName =
    document
      .getElementById("signUpPreferredName")
      .value.trim();

  profileError.textContent = "";

  if (!name) {
    profileError.textContent =
      "Please enter your name.";
    return;
  }

  if (!preferredName) {
    profileError.textContent =
      "Please tell us what you'd like to be called.";
    return;
  }

  sessionStorage.setItem(
    "prelude_signup_name",
    name
  );

  sessionStorage.setItem(
    "prelude_signup_preferred_name",
    preferredName
  );

  console.log("Profile information collected.");

  // Final signup submission will be connected here.
});
