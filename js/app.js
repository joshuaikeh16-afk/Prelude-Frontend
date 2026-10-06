const imageInput = document.getElementById("eventImage");
const imagePreview = document.getElementById("imagePreview");
const createForm = document.getElementById("createEventForm");
const formMessage = document.getElementById("formMessage");


/* IMAGE PREVIEW */

if (imageInput) {

  imageInput.addEventListener("change", () => {

    const file = imageInput.files[0];

    if (!file) {
      imagePreview.style.display = "none";
      return;
    }

    const imageURL = URL.createObjectURL(file);

    imagePreview.style.backgroundImage =
      `url("${imageURL}")`;

    imagePreview.style.display = "block";

  });

}


/* FORM */

if (createForm) {

  createForm.addEventListener("submit", (event) => {

    event.preventDefault();

    formMessage.textContent =
      "Event creation will connect to the Prelude backend here.";

  });

}
const params =
  new URLSearchParams(window.location.search);

const selectedDate =
  params.get("date");

const eventDate =
  document.getElementById("eventDate");

if (selectedDate && eventDate) {

  eventDate.value = selectedDate;

}