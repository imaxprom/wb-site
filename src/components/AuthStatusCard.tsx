"use client";

import { useState, useEffect, useCallback } from "react";

interface AuthStatus {
  api: "ok" | "dead" | null;
  lk: "ok" | "dead" | null;
  apiReason?: string | null;
  lkReason?: string | null;
  checkedAt: string | null;
  message?: string;
}

type AuthStep = "none" | "phone" | "code" | "supplier_select";

export function AuthStatusCard() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const [showKeyForm, setShowKeyForm] = useState(false);
  const [keyValue, setKeyValue] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMsg, setKeyMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [authStep, setAuthStep] = useState<AuthStep>("none");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMsg, setAuthMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/monitor/auth-status");
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      console.error("auth-status fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 60_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const allOk = status?.api === "ok" && status?.lk === "ok";
  const neverChecked = status && !status.checkedAt;
  const indicator = allOk ? "🟢" : status?.api || status?.lk ? "🔴" : "⚪";

  const submitKey = async () => {
    if (!keyValue.trim()) return;
    setKeyBusy(true);
    setKeyMsg(null);
    try {
      const res = await fetch("/api/monitor/auth-set-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: keyValue.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setKeyMsg({ ok: true, text: data.message || "Готово" });
        setKeyValue("");
        setShowKeyForm(false);
        setTimeout(fetchStatus, 500);
      } else {
        setKeyMsg({ ok: false, text: data.error || "Ошибка" });
      }
    } catch (err) {
      setKeyMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setKeyBusy(false);
    }
  };

  const startAuth = async () => {
    if (!phone.trim()) return;
    setAuthBusy(true);
    setAuthMsg(null);
    try {
      const res = await fetch("/api/wb/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const data = await res.json();
      if (data.ok && data.step === "code") {
        setAuthStep("code");
        setAuthMsg({ ok: true, text: "SMS отправлена — введи код." });
      } else {
        setAuthMsg({ ok: false, text: data.error || "Не удалось начать авторизацию" });
      }
    } catch (err) {
      setAuthMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setAuthBusy(false);
    }
  };

  const submitCode = async () => {
    if (!code.trim()) return;
    setAuthBusy(true);
    setAuthMsg(null);
    try {
      const res = await fetch("/api/wb/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (data.ok && data.step === "authenticated") {
        setAuthMsg({ ok: true, text: "Успех! Сессия обновлена." });
        setAuthStep("none");
        setPhone("");
        setCode("");
        setTimeout(fetchStatus, 500);
      } else if (data.ok && data.step === "supplier_select") {
        setSuppliers(data.suppliers || []);
        setAuthStep("supplier_select");
        setAuthMsg({ ok: true, text: "Выбери кабинет" });
      } else if (data.step === "code") {
        setAuthMsg({ ok: false, text: data.error || "Неверный код — попробуй ещё раз" });
      } else {
        setAuthMsg({ ok: false, text: data.error || "Ошибка" });
        setAuthStep("none");
      }
    } catch (err) {
      setAuthMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setAuthBusy(false);
    }
  };

  const selectSupplier = async (name: string) => {
    setAuthBusy(true);
    try {
      const res = await fetch("/api/wb/auth/select-supplier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplier: name }),
      });
      const data = await res.json();
      if (data.ok) {
        setAuthMsg({ ok: true, text: "Готово! Сессия обновлена." });
        setAuthStep("none");
        setTimeout(fetchStatus, 500);
      } else {
        setAuthMsg({ ok: false, text: data.error || "Ошибка" });
      }
    } catch (err) {
      setAuthMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setAuthBusy(false);
    }
  };

  if (loading) return null;

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{indicator}</span>
          <div>
            <h3 className="font-semibold text-white">Подключение к WB</h3>
            <p className="text-xs text-[var(--text-muted)]">
              {neverChecked
                ? status?.message || "Проверка ещё не запускалась"
                : status?.checkedAt
                  ? `Последняя проверка: ${new Date(status.checkedAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`
                  : "—"}
            </p>
          </div>
        </div>
        <button
          onClick={fetchStatus}
          className="text-xs px-2.5 py-1 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-white"
        >
          ↻
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className={`rounded-lg border px-3 py-2 ${status?.api === "dead" ? "border-[var(--danger)]/40 bg-[var(--danger)]/5" : "border-[var(--border)]"}`}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">API-ключ</span>
            <span className="text-xs">
              {status?.api === "ok" && <span className="text-[var(--success)]">✓ OK</span>}
              {status?.api === "dead" && <span className="text-[var(--danger)]">✕ Не работает</span>}
              {!status?.api && <span className="text-[var(--text-muted)]">—</span>}
            </span>
          </div>
          {status?.apiReason && <p className="text-[11px] text-[var(--text-muted)] mt-1">{status.apiReason}</p>}
          {status?.api === "dead" && !showKeyForm && (
            <button
              onClick={() => setShowKeyForm(true)}
              className="mt-2 text-xs px-3 py-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded"
            >
              Обновить API-ключ
            </button>
          )}
          {showKeyForm && (
            <div className="mt-2 space-y-2">
              <input
                type="password"
                value={keyValue}
                onChange={(e) => setKeyValue(e.target.value)}
                placeholder="Вставь новый JWT-ключ из WB"
                className="w-full text-xs px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded"
              />
              <div className="flex gap-2">
                <button
                  onClick={submitKey}
                  disabled={keyBusy || !keyValue.trim()}
                  className="text-xs px-3 py-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded disabled:opacity-40"
                >
                  {keyBusy ? "Проверяю..." : "Сохранить"}
                </button>
                <button
                  onClick={() => { setShowKeyForm(false); setKeyValue(""); setKeyMsg(null); }}
                  className="text-xs px-3 py-1.5 border border-[var(--border)] rounded"
                >
                  Отмена
                </button>
              </div>
              {keyMsg && (
                <p className={`text-[11px] ${keyMsg.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{keyMsg.text}</p>
              )}
            </div>
          )}
        </div>

        <div className={`rounded-lg border px-3 py-2 ${status?.lk === "dead" ? "border-[var(--danger)]/40 bg-[var(--danger)]/5" : "border-[var(--border)]"}`}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">ЛК (авторизация)</span>
            <span className="text-xs">
              {status?.lk === "ok" && <span className="text-[var(--success)]">✓ OK</span>}
              {status?.lk === "dead" && <span className="text-[var(--danger)]">✕ Разлогин</span>}
              {!status?.lk && <span className="text-[var(--text-muted)]">—</span>}
            </span>
          </div>
          {status?.lkReason && <p className="text-[11px] text-[var(--text-muted)] mt-1">{status.lkReason}</p>}
          {status?.lk === "dead" && authStep === "none" && (
            <button
              onClick={() => setAuthStep("phone")}
              className="mt-2 text-xs px-3 py-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded"
            >
              Обновить сессию ЛК
            </button>
          )}

          {authStep === "phone" && (
            <div className="mt-2 space-y-2">
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="9641521652"
                className="w-full text-xs px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded"
              />
              <div className="flex gap-2">
                <button
                  onClick={startAuth}
                  disabled={authBusy || !phone.trim()}
                  className="text-xs px-3 py-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded disabled:opacity-40"
                >
                  {authBusy ? "Отправляю..." : "Отправить SMS"}
                </button>
                <button onClick={() => { setAuthStep("none"); setPhone(""); }} className="text-xs px-3 py-1.5 border border-[var(--border)] rounded">
                  Отмена
                </button>
              </div>
            </div>
          )}

          {authStep === "code" && (
            <div className="mt-2 space-y-2">
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="SMS-код"
                className="w-full text-xs px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded"
              />
              <div className="flex gap-2">
                <button
                  onClick={submitCode}
                  disabled={authBusy || !code.trim()}
                  className="text-xs px-3 py-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded disabled:opacity-40"
                >
                  {authBusy ? "Проверяю..." : "Подтвердить"}
                </button>
                <button onClick={() => { setAuthStep("none"); setCode(""); }} className="text-xs px-3 py-1.5 border border-[var(--border)] rounded">
                  Отмена
                </button>
              </div>
            </div>
          )}

          {authStep === "supplier_select" && suppliers.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-[11px] text-[var(--text-muted)]">Выбери кабинет:</p>
              {suppliers.map((s) => (
                <button
                  key={s}
                  onClick={() => selectSupplier(s)}
                  disabled={authBusy}
                  className="block w-full text-left text-xs px-2 py-1.5 bg-[var(--bg)] hover:bg-[var(--bg-card-hover)] border border-[var(--border)] rounded"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {authMsg && (
            <p className={`text-[11px] mt-2 ${authMsg.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{authMsg.text}</p>
          )}
        </div>
      </div>
    </div>
  );
}
