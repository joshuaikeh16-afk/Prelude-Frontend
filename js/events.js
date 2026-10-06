const searchInput = document.getElementById("eventSearch");
const filters = document.querySelectorAll(".filter");

const upcomingEvents = document.getElementById("upcomingEvents");
const novemberEvents = document.getElementById("novemberEvents");
const emptyEvents = document.getElementById("emptyEvents");

const allCards = document.querySelectorAll(".event-card");


/* SEARCH */

searchInput.addEventListener("input", () => {

  const query = searchInput.value
    .trim()
    .toLowerCase();

  let visible = 0;

  allCards.forEach(card => {

    const text = card.textContent.toLowerCase();

    const matches = text.includes(query);

    card.style.display = matches
      ? ""
      : "none";

    if (matches) {
      visible++;
    }

  });

  emptyEvents.style.display =
    visible === 0
      ? "block"
      : "none";

});


/* UPCOMING / PAST */

filters.forEach(filter => {

  filter.addEventListener("click", () => {

    filters.forEach(item =>
      item.classList.remove("active")
    );

    filter.classList.add("active");

    const type = filter.dataset.filter;

    if (type === "past") {

      upcomingEvents.style.display = "none";
      novemberEvents.style.display = "none";

      emptyEvents.style.display = "block";

    } else {

      upcomingEvents.style.display = "";
      novemberEvents.style.display = "";

      emptyEvents.style.display = "none";

    }

  });

});