"use client";

import { useEffect, useState } from "react";

interface AuthStatus {
  api: "ok" | "dead" | null;
  lk: "ok" | "dead" | null;
  apiReason?: string | null;
  lkReason?: string | null;
  checkedAt: string | null;
}

/**
 * Маленькая строчка "Автопроверка в 22:00 МСК: ✓/✕ ...".
 * Читает результат последнего запуска scripts/auth-check.js.
 */
export function AutoCheckLine({ channel }: { channel: "api" | "lk" }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);

  useEffect(() => {
    fetch("/api/monitor/auth-status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);

  if (!status || !status.checkedAt) {
    return (
      <p className="text-xs text-[var(--text-muted)] mt-2">
        Автопроверка в 22:00 МСК: <span className="italic">ещё не запускалась</span>
      </p>
    );
  }

  const state = status[channel];
  const reason = channel === "api" ? status.apiReason : status.lkReason;
  const when = new Date(status.checkedAt).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  });

  if (state === "ok") {
    return (
      <p className="text-xs text-[var(--text-muted)] mt-2">
        Автопроверка в 22:00 МСК: <span className="text-[var(--success)]">✓</span> {when}
      </p>
    );
  }
  if (state === "dead") {
    return (
      <p className="text-xs text-[var(--danger)] mt-2">
        Автопроверка в 22:00 МСК: ✕ {when}
        {reason ? ` — ${reason}` : ""}
      </p>
    );
  }
  return null;
}
