const calendarGrid =
  document.getElementById("calendarGrid");

const monthName =
  document.getElementById("monthName");

const yearName =
  document.getElementById("yearName");

const selectedDate =
  document.getElementById("selectedDate");

const selectedEvents =
  document.getElementById("selectedEvents");

const calendarEmpty =
  document.getElementById("calendarEmpty");

const previousMonth =
  document.getElementById("previousMonth");

const nextMonth =
  document.getElementById("nextMonth");


let currentDate = new Date();

let selectedDay = currentDate.getDate();

let selectedMonth = currentDate.getMonth();

let selectedYear = currentDate.getFullYear();


/*
  Temporary frontend data.

  Later this will come from
  the Prelude backend.
*/

const events = [

  {
    date: "2026-10-12",
    title: "Birthday Dinner",
    time: "7:00 PM",
    location: "Abuja",
    priority: true
  },

  {
    date: "2026-10-24",
    title: "Table Tennis Competition",
    time: "9:00 AM",
    location: "Abuja",
    priority: false
  },

  {
    date: "2026-11-02",
    title: "Weekend Trip",
    time: "10:00 AM",
    location: "Not set",
    priority: false
  }

];


function formatDateKey(year, month, day) {

  const monthNumber =
    String(month + 1).padStart(2, "0");

  const dayNumber =
    String(day).padStart(2, "0");

  return `${year}-${monthNumber}-${dayNumber}`;

}


function renderCalendar() {

  calendarGrid.innerHTML = "";

  const firstDay =
    new Date(
      selectedYear,
      selectedMonth,
      1
    );

  const daysInMonth =
    new Date(
      selectedYear,
      selectedMonth + 1,
      0
    ).getDate();

  /*
    JS starts Sunday at 0.

    Convert it so Monday = 0.
  */

  let startingDay =
    firstDay.getDay() - 1;

  if (startingDay < 0) {
    startingDay = 6;
  }


  const previousMonthDays =
    new Date(
      selectedYear,
      selectedMonth,
      0
    ).getDate();


  /*
    Previous month days
  */

  for (
    let i = startingDay - 1;
    i >= 0;
    i--
  ) {

    const day =
      previousMonthDays - i;

    createDay(
      day,
      true,
      selectedYear,
      selectedMonth - 1
    );

  }


  /*
    Current month
  */

  for (
    let day = 1;
    day <= daysInMonth;
    day++
  ) {

    createDay(
      day,
      false,
      selectedYear,
      selectedMonth
    );

  }


  /*
    Next month days
  */

  const totalCells =
    calendarGrid.children.length;

  const remaining =
    42 - totalCells;

  for (
    let day = 1;
    day <= remaining;
    day++
  ) {

    createDay(
      day,
      true,
      selectedYear,
      selectedMonth + 1
    );

  }


  monthName.textContent =
    new Date(
      selectedYear,
      selectedMonth
    ).toLocaleString(
      "en-US",
      { month: "long" }
    );

  yearName.textContent =
    selectedYear;


  updateSelectedDate();

}


function createDay(
  day,
  muted,
  year,
  month
) {

  const actualDate =
    new Date(year, month, day);

  const actualYear =
    actualDate.getFullYear();

  const actualMonth =
    actualDate.getMonth();

  const actualDay =
    actualDate.getDate();


  const key =
    formatDateKey(
      actualYear,
      actualMonth,
      actualDay
    );

  const dayAddButton =
  document.querySelector(".day-add-button");
  if (dayAddButton) {

  dayAddButton.addEventListener("click", (event) => {

    event.preventDefault();

    const month =
      String(selectedMonth + 1).padStart(2, "0");

    const day =
      String(selectedDay).padStart(2, "0");

    const date =
      `${selectedYear}-${month}-${day}`;

    window.location.href =
      `create.html?date=${date}`;

  });

}

  const dayEvents =
    events.filter(
      event => event.date === key
    );


  const button =
    document.createElement("button");

  button.className =
    "calendar-day";


  if (muted) {
    button.classList.add("muted");
  }


  if (
    actualYear === selectedYear &&
    actualMonth === selectedMonth &&
    actualDay === selectedDay
  ) {

    button.classList.add("selected");

  }


  const today =
    new Date();

  if (
    actualYear === today.getFullYear() &&
    actualMonth === today.getMonth() &&
    actualDay === today.getDate()
  ) {

    button.classList.add("today");

  }


  const number =
    document.createElement("span");

  number.className =
    "calendar-day-number";

  number.textContent =
    actualDay;


  button.appendChild(number);


  if (dayEvents.length) {

    const dots =
      document.createElement("div");

    dots.className =
      "calendar-dots";


    dayEvents
      .slice(0, 3)
      .forEach(event => {

        const dot =
          document.createElement("span");

        dot.className =
          "calendar-dot";

        if (event.priority) {
          dot.classList.add("priority");
        }

        dots.appendChild(dot);

      });


    button.appendChild(dots);

  }


  button.addEventListener(
    "click",
    () => {

      selectedDay =
        actualDay;

      selectedMonth =
        actualMonth;

      selectedYear =
        actualYear;

      renderCalendar();

    }
  );


  calendarGrid.appendChild(button);

}


function updateSelectedDate() {

  const date =
    new Date(
      selectedYear,
      selectedMonth,
      selectedDay
    );


  selectedDate.textContent =
    date.toLocaleDateString(
      "en-US",
      {
        weekday: "long",
        day: "numeric",
        month: "long"
      }
    );


  const key =
    formatDateKey(
      selectedYear,
      selectedMonth,
      selectedDay
    );


  const dayEvents =
    events.filter(
      event => event.date === key
    );


  selectedEvents.innerHTML = "";


  if (!dayEvents.length) {

    selectedEvents.style.display =
      "none";

    calendarEmpty.style.display =
      "block";

    return;

  }


  selectedEvents.style.display =
    "flex";

  calendarEmpty.style.display =
    "none";


  dayEvents.forEach(event => {

    const link =
      document.createElement("a");

    link.href =
      "event.html";

    link.className =
      "calendar-event";


    link.innerHTML = `

      <div class="calendar-event-time">

        <strong>
          ${event.time.split(" ")[0]}
        </strong>

        <span>
          ${event.time.split(" ")[1]}
        </span>

      </div>

      <div class="calendar-event-info">

        ${
          event.priority
            ? `<span class="calendar-event-priority">
                PRIORITY
              </span>`
            : ""
        }

        <h3>
          ${event.title}
        </h3>

        <p>
          ${event.location}
        </p>

      </div>

      <span class="card-arrow">
        ›
      </span>

    `;


    selectedEvents.appendChild(link);

  });

}


previousMonth.addEventListener(
  "click",
  () => {

    selectedMonth--;

    if (selectedMonth < 0) {

      selectedMonth = 11;
      selectedYear--;

    }

    selectedDay = 1;

    renderCalendar();

  }
);


nextMonth.addEventListener(
  "click",
  () => {

    selectedMonth++;

    if (selectedMonth > 11) {

      selectedMonth = 0;
      selectedYear++;

    }

    selectedDay = 1;

    renderCalendar();

  }
);


renderCalendar();