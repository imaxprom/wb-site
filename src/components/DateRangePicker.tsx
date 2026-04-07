"use client";

import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const MONTHS_RU = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const DAYS_RU = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

interface DayCell {
  date: string; // "YYYY-MM-DD"
  day: number;
  isCurrentMonth: boolean;
  isWeekend: boolean; // sat (index 5) or sun (index 6)
}

interface DateRangePickerProps {
  dateFrom: string; // "YYYY-MM-DD"
  dateTo: string;
  minDate?: string; // full data range start (for reset)
  maxDate?: string; // full data range end (for reset)
  onChange: (from: string, to: string) => void;
  onClose: () => void;
}

function buildMonthGrid(year: number, month: number): DayCell[] {
  // month: 0-based (0=Jan)
  const cells: DayCell[] = [];
  const firstDay = new Date(year, month, 1);
  // JS getDay(): 0=Sun,1=Mon,...,6=Sat → convert to Mon=0..Sun=6
  const startDow = (firstDay.getDay() + 6) % 7; // Mon=0, Tue=1, ..., Sun=6
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  // Fill leading days from prev month
  for (let i = startDow - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    const dateStr = `${prevYear}-${String(prevMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dow = (new Date(prevYear, prevMonth, d).getDay() + 6) % 7;
    cells.push({ date: dateStr, day: d, isCurrentMonth: false, isWeekend: dow >= 5 });
  }

  // Fill current month
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dow = (new Date(year, month, d).getDay() + 6) % 7;
    cells.push({ date: dateStr, day: d, isCurrentMonth: true, isWeekend: dow >= 5 });
  }

  // Fill trailing days from next month to reach 42 cells
  const nextMonth = month === 11 ? 0 : month + 1;
  const nextYear = month === 11 ? year + 1 : year;
  let nextDay = 1;
  while (cells.length < 42) {
    const dateStr = `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}-${String(nextDay).padStart(2, "0")}`;
    const dow = (new Date(nextYear, nextMonth, nextDay).getDay() + 6) % 7;
    cells.push({ date: dateStr, day: nextDay, isCurrentMonth: false, isWeekend: dow >= 5 });
    nextDay++;
  }

  return cells;
}

function formatDisplayDate(d: string): string {
  if (!d) return "";
  // "YYYY-MM-DD" → "DD.MM.YY"
  return `${d.slice(8)}.${d.slice(5, 7)}.${d.slice(2, 4)}`;
}

export default function DateRangePicker({
  dateFrom,
  dateTo,
  minDate,
  maxDate,
  onChange,
  onClose,
}: DateRangePickerProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Base month for the left calendar (0-based month)
  const [baseYear, setBaseYear] = useState<number>(() => {
    if (dateFrom) return parseInt(dateFrom.slice(0, 4));
    return new Date().getFullYear();
  });
  const [baseMonth, setBaseMonth] = useState<number>(() => {
    if (dateFrom) return parseInt(dateFrom.slice(5, 7)) - 1;
    return new Date().getMonth();
  });

  // Selection state
  // "selecting": waiting for second click; "done": both selected
  const [hoverDate, setHoverDate] = useState<string>("");
  const [selecting, setSelecting] = useState(false);
  const [tempStart, setTempStart] = useState<string>(dateFrom);

  const today = new Date().toISOString().slice(0, 10);

  // Right month
  let rightMonth = baseMonth + 1;
  let rightYear = baseYear;
  if (rightMonth > 11) {
    rightMonth = 0;
    rightYear++;
  }

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  function prevMonth() {
    if (baseMonth === 0) {
      setBaseMonth(11);
      setBaseYear(baseYear - 1);
    } else {
      setBaseMonth(baseMonth - 1);
    }
  }

  function nextMonth() {
    if (baseMonth === 11) {
      setBaseMonth(0);
      setBaseYear(baseYear + 1);
    } else {
      setBaseMonth(baseMonth + 1);
    }
  }

  function isDisabled(date: string): boolean {
    if (minDate && date < minDate) return true;
    if (date > today) return true;
    return false;
  }

  function handleDayClick(date: string) {
    if (isDisabled(date)) return;
    if (!selecting) {
      // Start new selection
      setTempStart(date);
      setSelecting(true);
    } else {
      // Complete selection
      let from = tempStart;
      let to = date;
      if (to < from) {
        [from, to] = [to, from];
      }
      setSelecting(false);
      setTempStart(from);
      onChange(from, to);
      onClose();
    }
  }

  function isInRange(date: string): boolean {
    const start = selecting ? tempStart : dateFrom;
    const end = selecting ? (hoverDate || dateTo) : dateTo;
    if (!start || !end) return false;
    const lo = start < end ? start : end;
    const hi = start < end ? end : start;
    return date > lo && date < hi;
  }

  function isStart(date: string): boolean {
    if (selecting) return date === tempStart;
    return date === dateFrom;
  }

  function isEnd(date: string): boolean {
    if (selecting) return hoverDate ? date === hoverDate : false;
    return date === dateTo;
  }

  function handleReset() {
    if (minDate && maxDate) {
      onChange(minDate, maxDate);
    }
    onClose();
  }

  function renderMonth(year: number, month: number) {
    const cells = buildMonthGrid(year, month);
    return (
      <div className="flex flex-col gap-2">
        {/* Month header */}
        <p className="text-sm font-semibold text-white text-center">
          {MONTHS_RU[month]} {year}
        </p>

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 gap-0">
          {DAYS_RU.map((d, i) => (
            <div
              key={d}
              className={cn(
                "text-center text-xs py-1 font-medium",
                i >= 5 ? "text-[#F4A236]" : "text-[var(--text-muted)]"
              )}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 gap-0">
          {cells.map((cell) => {
            const inRange = isInRange(cell.date);
            const start = isStart(cell.date);
            const end = isEnd(cell.date);
            const isToday = cell.date === today;
            const selected = start || end;
            const disabled = isDisabled(cell.date);

            if (!cell.isCurrentMonth) {
              return <div key={cell.date} className="h-8" />;
            }

            return (
              <button
                key={cell.date}
                disabled={disabled}
                onMouseEnter={() => selecting && !disabled && setHoverDate(cell.date)}
                onMouseLeave={() => selecting && setHoverDate("")}
                onClick={() => handleDayClick(cell.date)}
                className={cn(
                  "relative flex items-center justify-center text-sm h-8 w-full transition-colors",
                  // Disabled
                  disabled && "text-[var(--text-muted)] opacity-20 cursor-not-allowed",
                  // Base text color
                  !disabled && !selected && cell.isWeekend && "text-[#F4A236]",
                  !disabled && !selected && !cell.isWeekend && "text-[var(--text)]",
                  // Hover
                  !disabled && !selected && !inRange && "hover:bg-[var(--bg-card-hover)] hover:rounded",
                  // Today ring
                  isToday && !selected && !disabled && "ring-1 ring-[var(--accent)] rounded-full",
                  // Selected: full accent circle
                  selected && !disabled && "bg-[var(--accent)] text-white rounded-full z-10"
                )}
                style={
                  !disabled && inRange && !selected
                    ? { backgroundColor: "rgba(99, 102, 241, 0.25)" }
                    : undefined
                }
              >
                {cell.day}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const displayFrom = selecting ? formatDisplayDate(tempStart) : formatDisplayDate(dateFrom);
  const displayTo = selecting
    ? hoverDate
      ? formatDisplayDate(hoverDate)
      : "..."
    : formatDisplayDate(dateTo);

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full mt-2 z-50 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-xl p-4"
      style={{ minWidth: 540 }}
    >
      {/* Input display */}
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-medium text-white">
          📅 {displayFrom} – {displayTo}
        </p>
        <button
          onClick={onClose}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors ml-4"
        >
          ✕
        </button>
      </div>

      {/* Navigation + Two months */}
      <div className="flex items-start gap-2">
        {/* Prev arrow */}
        <button
          onClick={prevMonth}
          className="mt-1 p-1.5 text-[var(--text-muted)] hover:text-white transition-colors rounded hover:bg-[var(--bg-card-hover)]"
          aria-label="Предыдущий месяц"
        >
          ‹
        </button>

        <div className="flex-1 grid grid-cols-2 gap-6">
          {renderMonth(baseYear, baseMonth)}
          {renderMonth(rightYear, rightMonth)}
        </div>

        {/* Next arrow */}
        <button
          onClick={nextMonth}
          className="mt-1 p-1.5 text-[var(--text-muted)] hover:text-white transition-colors rounded hover:bg-[var(--bg-card-hover)]"
          aria-label="Следующий месяц"
        >
          ›
        </button>
      </div>

      {/* Reset button */}
      {(minDate && maxDate) && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={handleReset}
            className="text-xs text-[var(--accent)] hover:text-white cursor-pointer transition-colors"
          >
            Сбросить
          </button>
        </div>
      )}
    </div>
  );
}
