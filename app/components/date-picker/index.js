import { setHidden } from "../../utils/dom.js";
import { onDocumentClickOutside, onDocumentEscape } from "../../utils/document-listeners.js";
import {
  buildMonthCells,
  ensureWeekdayLabels,
  getYearWindowStart,
  monthLabel,
} from "./calendar.js";
import {
  formatClockTime,
  formatDisplayDate,
  formatResult,
  getTodayDate,
  isAfterDay,
  isBeforeDay,
  parseInputDate,
  parseISODate,
  sameDay,
  toISODate,
} from "./parse.js";

/**
 * Custom calendar popup with optional time input.
 *
 * Markup:
 *   <div class="date-picker" data-date-picker-time>
 *     <div class="date-picker-popup hidden" role="dialog" aria-modal="true" aria-label="Choose date" hidden>
 *       …
 *     </div>
 *   </div>
 *
 * data-date-picker-time — show `.date-picker-time` on the same row inside `.date-picker-row`
 * data-date-min / data-date-max — ISO date strings (YYYY-MM-DD)
 */

/** @typedef {"days" | "months" | "years"} DatePickerView */

export function initDatePicker(
  pickerEl,
  { locale, min, max, defaultDate, defaultTime, onChange, onError } = {}
) {
  if (!pickerEl) return null;

  const valueInput = pickerEl.querySelector(".date-picker-value");
  const displayInput = pickerEl.querySelector(".date-picker-input");
  const trigger = pickerEl.querySelector(".date-picker-trigger");
  const popup = pickerEl.querySelector(".date-picker-popup");
  const captionEl =
    pickerEl.querySelector(".date-picker-caption") ||
    pickerEl.querySelector(".date-picker-month");
  const weekdaysEl = pickerEl.querySelector(".date-picker-weekdays");
  const grid = pickerEl.querySelector(".date-picker-grid");
  const prevBtn = pickerEl.querySelector("[data-date-picker-prev]");
  const nextBtn = pickerEl.querySelector("[data-date-picker-next]");
  let timeInput = pickerEl.querySelector(".date-picker-time");

  if (!displayInput || !popup || !grid || !captionEl) return null;

  ensureWeekdayLabels(weekdaysEl);

  const hasTime =
    pickerEl.hasAttribute("data-date-picker-time") ||
    pickerEl.dataset.datePickerTime === "true";

  const minDate = parseISODate(min ?? pickerEl.dataset.dateMin);
  const maxDate = parseISODate(max ?? pickerEl.dataset.dateMax);

  if (hasTime && timeInput) {
    setHidden(timeInput, false);
  }

  const popupId = popup.id || `date-picker-popup-${Math.random().toString(36).slice(2, 9)}`;
  if (!popup.id) popup.id = popupId;
  trigger?.setAttribute("aria-controls", popupId);

  let viewDate = parseISODate(defaultDate ?? valueInput?.value) ?? new Date();
  let selectedDate = parseISODate(defaultDate ?? valueInput?.value);
  /** @type {DatePickerView} */
  let viewMode = "days";
  let isOpen = false;
  let actionsEl = popup.querySelector(".date-picker-actions");
  let todayBtn = actionsEl?.querySelector("[data-date-picker-today]") ?? null;
  let nowBtn = actionsEl?.querySelector("[data-date-picker-now]") ?? null;

  function isDisabledDate(date) {
    if (minDate && isBeforeDay(date, minDate)) return true;
    if (maxDate && isAfterDay(date, maxDate)) return true;
    return false;
  }

  function isMonthDisabled(year, month) {
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    if (minDate && isBeforeDay(last, minDate)) return true;
    if (maxDate && isAfterDay(first, maxDate)) return true;
    return false;
  }

  function isYearDisabled(year) {
    const first = new Date(year, 0, 1);
    const last = new Date(year, 11, 31);
    if (minDate && isBeforeDay(last, minDate)) return true;
    if (maxDate && isAfterDay(first, maxDate)) return true;
    return false;
  }

  function emitChange() {
    onChange?.({
      pickerEl,
      date: selectedDate,
      isoDate: selectedDate ? toISODate(selectedDate) : "",
      time: hasTime && timeInput ? timeInput.value : "",
      display: selectedDate ? formatResult(selectedDate, timeInput?.value, hasTime) : "",
    });
  }

  function syncInputs() {
    const isoDate = selectedDate ? toISODate(selectedDate) : "";
    if (valueInput) valueInput.value = isoDate;
    displayInput.value = selectedDate ? formatDisplayDate(selectedDate, locale) : "";
    emitChange();
  }

  function restoreDisplayValue() {
    displayInput.value = selectedDate ? formatDisplayDate(selectedDate, locale) : "";
  }

  function commitInputValue() {
    const { date, valid } = parseInputDate(displayInput.value);

    if (!displayInput.value.trim()) {
      selectedDate = null;
      displayInput.removeAttribute("aria-invalid");
      syncInputs();
      if (isOpen) render();
      return true;
    }

    if (!valid || !date) {
      restoreDisplayValue();
      displayInput.setAttribute("aria-invalid", "true");
      onError?.({ pickerEl, message: "Enter a valid date.", value: displayInput.value });
      return false;
    }

    if (isDisabledDate(date)) {
      restoreDisplayValue();
      displayInput.setAttribute("aria-invalid", "true");
      onError?.({ pickerEl, message: "Date is outside the allowed range.", value: displayInput.value });
      return false;
    }

    selectedDate = date;
    viewDate = new Date(date.getFullYear(), date.getMonth(), 1);
    displayInput.removeAttribute("aria-invalid");
    syncInputs();
    if (isOpen) render();
    return true;
  }

  function applyQuickSelect({ useNow = false } = {}) {
    const today = getTodayDate();

    if (isDisabledDate(today)) {
      onError?.({ pickerEl, message: "Today is outside the allowed range." });
      return;
    }

    selectedDate = today;
    viewDate = new Date(today.getFullYear(), today.getMonth(), 1);
    viewMode = "days";

    if (hasTime && timeInput) {
      timeInput.value = useNow ? formatClockTime(new Date()) : "00:00";
    }

    displayInput.removeAttribute("aria-invalid");
    syncInputs();
    render();
    closePopup();
    displayInput.focus();
  }

  function ensureQuickActions() {
    if (!actionsEl) {
      actionsEl = document.createElement("div");
      actionsEl.className = "date-picker-actions";
      popup.append(actionsEl);
    }

    if (!todayBtn) {
      todayBtn = document.createElement("button");
      todayBtn.type = "button";
      todayBtn.className = "btn btn-slim date-picker-quick-btn";
      todayBtn.dataset.datePickerToday = "";
      todayBtn.textContent = "Today";
      actionsEl.append(todayBtn);
    }

    if (!todayBtn.dataset.datePickerBound) {
      todayBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        applyQuickSelect({ useNow: false });
      });
      todayBtn.dataset.datePickerBound = "true";
    }

    if (hasTime) {
      if (!nowBtn) {
        nowBtn = document.createElement("button");
        nowBtn.type = "button";
        nowBtn.className = "btn btn-slim date-picker-quick-btn";
        nowBtn.dataset.datePickerNow = "";
        nowBtn.textContent = "Now";
        actionsEl.append(nowBtn);
      }

      setHidden(nowBtn, false);

      if (!nowBtn.dataset.datePickerBound) {
        nowBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          applyQuickSelect({ useNow: true });
        });
        nowBtn.dataset.datePickerBound = "true";
      }
    } else if (nowBtn) {
      setHidden(nowBtn, true);
    }
  }

  function setQuickActionsVisible(visible) {
    if (actionsEl) setHidden(actionsEl, !visible);
  }

  function updateQuickActions() {
    if (!todayBtn) return;

    const todayDisabled = isDisabledDate(getTodayDate());
    todayBtn.disabled = todayDisabled;
    if (nowBtn && !nowBtn.hidden) nowBtn.disabled = todayDisabled;
  }

  function createCaptionButton(label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "date-picker-caption-part";
    button.textContent = label;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  function renderHeader() {
    captionEl.replaceChildren();
    captionEl.classList.remove("date-picker-caption-range");

    if (viewMode === "days") {
      prevBtn?.setAttribute("aria-label", "Previous month");
      nextBtn?.setAttribute("aria-label", "Next month");
      captionEl.append(
        createCaptionButton(monthLabel(viewDate, locale, "long"), () => {
          viewMode = "months";
          render();
        }),
        createCaptionButton(String(viewDate.getFullYear()), () => {
          viewMode = "years";
          render();
        })
      );
      return;
    }

    if (viewMode === "months") {
      prevBtn?.setAttribute("aria-label", "Previous year");
      nextBtn?.setAttribute("aria-label", "Next year");
      captionEl.append(
        createCaptionButton(String(viewDate.getFullYear()), () => {
          viewMode = "years";
          render();
        })
      );
      return;
    }

    const startYear = getYearWindowStart(viewDate.getFullYear());
    const endYear = startYear + 11;
    prevBtn?.setAttribute("aria-label", "Previous years");
    nextBtn?.setAttribute("aria-label", "Next years");
    captionEl.classList.add("date-picker-caption-range");
    captionEl.textContent = `${startYear} - ${endYear}`;
  }

  function renderDays() {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const today = new Date();

    if (weekdaysEl) setHidden(weekdaysEl, false);
    grid.classList.remove("is-choice-grid");
    grid.setAttribute("role", "grid");

    grid.replaceChildren();

    buildMonthCells(year, month).forEach(({ date, outside }) => {
      const dayBtn = document.createElement("button");
      dayBtn.type = "button";
      dayBtn.className = "date-picker-day";
      dayBtn.setAttribute("role", "gridcell");
      dayBtn.dataset.date = toISODate(date);
      dayBtn.textContent = String(date.getDate());

      if (outside) dayBtn.classList.add("is-outside");
      if (sameDay(date, today)) dayBtn.classList.add("is-today");
      if (selectedDate && sameDay(date, selectedDate)) {
        dayBtn.classList.add("is-selected");
        dayBtn.setAttribute("aria-selected", "true");
      } else {
        dayBtn.setAttribute("aria-selected", "false");
      }

      if (isDisabledDate(date)) {
        dayBtn.disabled = true;
      }

      dayBtn.addEventListener("click", () => {
        selectedDate = date;
        viewDate = new Date(date.getFullYear(), date.getMonth(), 1);
        syncInputs();
        viewMode = "days";
        render();
        closePopup();
        if (hasTime && timeInput) timeInput.focus();
        else displayInput.focus();
      });

      grid.append(dayBtn);
    });
  }

  function renderMonths() {
    const year = viewDate.getFullYear();

    if (weekdaysEl) setHidden(weekdaysEl, true);
    grid.classList.add("is-choice-grid");
    grid.setAttribute("role", "listbox");
    grid.replaceChildren();

    for (let month = 0; month < 12; month += 1) {
      const monthBtn = document.createElement("button");
      monthBtn.type = "button";
      monthBtn.className = "date-picker-choice";
      monthBtn.setAttribute("role", "option");
      monthBtn.textContent = monthLabel(new Date(year, month, 1), locale, "short");

      if (month === viewDate.getMonth()) {
        monthBtn.classList.add("is-selected");
        monthBtn.setAttribute("aria-selected", "true");
      } else {
        monthBtn.setAttribute("aria-selected", "false");
      }

      if (isMonthDisabled(year, month)) {
        monthBtn.disabled = true;
      }

      monthBtn.addEventListener("click", () => {
        viewDate = new Date(year, month, 1);
        viewMode = "days";
        render();
      });

      grid.append(monthBtn);
    }
  }

  function renderYears() {
    const startYear = getYearWindowStart(viewDate.getFullYear());

    if (weekdaysEl) setHidden(weekdaysEl, true);
    grid.classList.add("is-choice-grid");
    grid.setAttribute("role", "listbox");
    grid.replaceChildren();

    for (let year = startYear; year < startYear + 12; year += 1) {
      const yearBtn = document.createElement("button");
      yearBtn.type = "button";
      yearBtn.className = "date-picker-choice";
      yearBtn.setAttribute("role", "option");
      yearBtn.textContent = String(year);

      if (year === viewDate.getFullYear()) {
        yearBtn.classList.add("is-selected");
        yearBtn.setAttribute("aria-selected", "true");
      } else {
        yearBtn.setAttribute("aria-selected", "false");
      }

      if (isYearDisabled(year)) {
        yearBtn.disabled = true;
      }

      yearBtn.addEventListener("click", () => {
        viewDate = new Date(year, viewDate.getMonth(), 1);
        viewMode = "months";
        render();
      });

      grid.append(yearBtn);
    }
  }

  function render() {
    renderHeader();

    if (viewMode === "months") {
      setQuickActionsVisible(false);
      renderMonths();
      return;
    }

    if (viewMode === "years") {
      setQuickActionsVisible(false);
      renderYears();
      return;
    }

    setQuickActionsVisible(true);
    updateQuickActions();
    renderDays();
  }

  function openPopup() {
    if (isOpen) return;
    isOpen = true;
    viewMode = "days";
    const viewFrom = selectedDate ?? parseInputDate(displayInput.value).date;
    if (viewFrom) {
      viewDate = new Date(viewFrom.getFullYear(), viewFrom.getMonth(), 1);
    }
    render();
    setHidden(popup, false);
    trigger?.setAttribute("aria-expanded", "true");
    prevBtn?.focus();
  }

  function closePopup() {
    if (!isOpen) return;
    isOpen = false;
    viewMode = "days";
    setHidden(popup, true);
    trigger?.setAttribute("aria-expanded", "false");
  }

  function togglePopup() {
    if (isOpen) closePopup();
    else openPopup();
  }

  function shiftView(delta) {
    if (viewMode === "days") {
      viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1);
    } else if (viewMode === "months") {
      viewDate = new Date(viewDate.getFullYear() + delta, viewDate.getMonth(), 1);
    } else {
      const startYear = getYearWindowStart(viewDate.getFullYear()) + delta * 12;
      viewDate = new Date(startYear, viewDate.getMonth(), 1);
    }
    render();
  }

  function stepBackView() {
    if (viewMode === "years") {
      viewMode = "months";
      render();
      return true;
    }
    if (viewMode === "months") {
      viewMode = "days";
      render();
      return true;
    }
    return false;
  }

  displayInput.removeAttribute("readonly");
  if (!displayInput.placeholder) {
    displayInput.placeholder = "Jun 20, 2026";
  }

  displayInput.addEventListener("blur", (event) => {
    const next = event.relatedTarget;
    if (
      next &&
      (next === trigger ||
        next.closest?.(".date-picker-popup") ||
        next.closest?.(".date-picker-trigger"))
    ) {
      return;
    }
    commitInputValue();
  });

  displayInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitInputValue();
      closePopup();
      return;
    }

    if (event.key === "ArrowDown" && !isOpen) {
      event.preventDefault();
      openPopup();
      return;
    }

    if (event.key === "Escape" && isOpen) {
      event.stopPropagation();
    }
  });

  displayInput.addEventListener("focus", () => {
    displayInput.removeAttribute("aria-invalid");
  });

  trigger?.addEventListener("click", (event) => {
    event.stopPropagation();
    togglePopup();
  });

  prevBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    shiftView(-1);
  });

  nextBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    shiftView(1);
  });

  popup.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  timeInput?.addEventListener("change", () => {
    if (selectedDate) emitChange();
  });

  const removeClickOutside = onDocumentClickOutside((event) => {
    if (!pickerEl.contains(event.target)) {
      commitInputValue();
      closePopup();
    }
  });

  const removeEscape = onDocumentEscape(() => {
    if (!isOpen) return false;
    if (stepBackView()) return true;
    closePopup();
    trigger?.focus();
    return true;
  }, { priority: 50 });

  if (defaultTime && timeInput) {
    timeInput.value = defaultTime;
  }

  ensureQuickActions();

  if (selectedDate) {
    syncInputs();
  } else {
    emitChange();
  }

  return {
    open: openPopup,
    close: closePopup,
    getValue: () => ({
      date: selectedDate,
      isoDate: selectedDate ? toISODate(selectedDate) : "",
      time: hasTime && timeInput ? timeInput.value : "",
    }),
    setValue: ({ date, isoDate, time } = {}) => {
      const nextDate = date ?? parseISODate(isoDate);
      selectedDate = nextDate;
      if (nextDate) {
        viewDate = new Date(nextDate.getFullYear(), nextDate.getMonth(), 1);
      }
      if (time !== undefined && timeInput) timeInput.value = time;
      syncInputs();
      if (isOpen) render();
    },
    destroy: () => {
      removeClickOutside();
      removeEscape();
      closePopup();
    },
  };
}

/** Wire every `.date-picker` block in `root`. */
export function initDatePickers(root = document) {
  const instances = [];
  root.querySelectorAll(".date-picker").forEach((pickerEl) => {
    const instance = initDatePicker(pickerEl);
    if (instance) instances.push(instance);
  });
  return instances;
}
