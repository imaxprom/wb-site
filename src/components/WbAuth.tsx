"use client";

import { useState, useEffect, useRef } from "react";
import { AutoCheckLine } from "./AutoCheckLine";

type Step = "loading" | "phone" | "captcha" | "code" | "processing" | "supplier_select" | "authenticated";
type LegalEntityOption = {
  id: string;
  name: string;
  subtitle?: string;
  supplierId?: string;
  storeName?: string;
  inn?: string;
};
type AuthApiResult = {
  ok: boolean;
  step: string;
  captchaImage?: string;
  error?: string;
  warning?: string;
  legalEntities?: LegalEntityOption[];
  selectedLegalEntity?: LegalEntityOption;
  suppliers?: string[];
  currentSupplier?: string;
  retryAfterSeconds?: number;
  message?: string;
};

export function WbAuth() {
  const [step, setStep] = useState<Step>("loading");
  const [phone, setPhone] = useState("+7 (");

  function formatPhone(value: string): string {
    // Strip everything except digits
    const digits = value.replace(/\D/g, "");
    // Always start with 7
    const d = digits.startsWith("7") ? digits : "7" + digits;
    // Max 11 digits (7 + 10)
    const limited = d.slice(0, 11);
    // Format: +7 (XXX) XXX-XX-XX
    let result = "+7";
    if (limited.length > 1) result += " (" + limited.slice(1, 4);
    if (limited.length >= 4) result += ") ";
    if (limited.length > 4) result += limited.slice(4, 7);
    if (limited.length > 7) result += "-" + limited.slice(7, 9);
    if (limited.length > 9) result += "-" + limited.slice(9, 11);
    return result;
  }
  const [code, setCode] = useState("");
  const [captchaText, setCaptchaText] = useState("");
  const [captchaImage, setCaptchaImage] = useState("");
  const [legalEntities, setLegalEntities] = useState<LegalEntityOption[]>([]);
  const [currentSupplier, setCurrentSupplier] = useState("");
  const [sessionInfo, setSessionInfo] = useState<{
    supplier?: string;
    phone?: string;
    storeName?: string;
    inn?: string;
    supplierId?: string;
  }>({});
  const [sessionActive, setSessionActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [processingMessage, setProcessingMessage] = useState("Ожидаем ответ Wildberries...");
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [cooldownPhone, setCooldownPhone] = useState("");
  const [now, setNow] = useState(Date.now());
  const codeRef = useRef<HTMLInputElement>(null);
  const captchaRef = useRef<HTMLInputElement>(null);
  const phoneCooldownSeconds = cooldownPhone === normalizePhoneForCooldown(phone) && cooldownUntil
    ? Math.max(0, Math.ceil((cooldownUntil - now) / 1000))
    : 0;

  useEffect(() => {
    checkSession();
  }, []);

  useEffect(() => {
    if (!cooldownUntil) return;

    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [cooldownUntil]);

  // Auto-focus inputs when step changes
  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
    if (step === "captcha") captchaRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (step !== "processing") return;

    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    const poll = async () => {
      if (!active) return;
      try {
        const response = await fetch(`/api/wb/auth/progress?ts=${Date.now()}`, { cache: "no-store" });
        const data = await response.json() as AuthApiResult;
        if (!active) return;
        if (data.step === "processing" && data.ok) {
          setProcessingMessage(data.message || "Ожидаем ответ Wildberries...");
        } else {
          handleStepResult(data);
          return;
        }
      } catch {
        // A single failed poll must not abort an otherwise valid WB browser session.
      }

      if (Date.now() - startedAt >= 6 * 60 * 1000) {
        setError("Wildberries не завершил авторизацию за 6 минут. Запросите новый SMS-код.");
        setStep("phone");
        return;
      }
      timer = setTimeout(poll, 1500);
    };

    timer = setTimeout(poll, 1200);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
    // handleStepResult intentionally reads the latest component state on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function applyActiveSession(data: {
    supplier?: string;
    phone?: string;
    storeName?: string;
    inn?: string;
    supplierId?: string;
  }) {
    setSessionInfo({
      supplier: data.supplier,
      phone: data.phone,
      storeName: data.storeName,
      inn: data.inn,
      supplierId: data.supplierId,
    });
    setSessionActive(true);
    setError("");
    setStep("authenticated");
  }

  async function checkSession(): Promise<boolean> {
    try {
      const res = await fetch(`/api/wb/auth?ts=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
        applyActiveSession(data);
        return true;
      } else {
        setSessionActive(false);
        setStep("phone");
      }
    } catch {
      setSessionActive(false);
      setStep("phone");
    }
    return false;
  }

  async function recoverFromConnectionError() {
    const ok = await checkSession();
    if (!ok) setError("Ошибка соединения с сервером");
  }

  function handleStepResult(data: AuthApiResult) {
    if (!data.ok && data.step === "error") {
      if (data.retryAfterSeconds && data.retryAfterSeconds > 0) {
        setCooldownPhone(normalizePhoneForCooldown(phone));
        setCooldownUntil(Date.now() + data.retryAfterSeconds * 1000);
      }
      setError(data.error || "Неизвестная ошибка");
      setStep("phone");
      return;
    }

    // If wrong code — show error but stay on code step
    if (!data.ok && data.step === "code") {
      setError(data.error || "Неверный код");
      setCode("");
      setStep("code");
      return;
    }

    setError("");
    setSessionActive(false);
    setCooldownUntil(null);
    if (data.warning) setWarning(data.warning);

    switch (data.step) {
      case "captcha":
        setCaptchaImage(data.captchaImage || "");
        setCaptchaText("");
        setStep("captcha");
        break;
      case "code":
        setCode("");
        setStep("code");
        break;
      case "processing":
        setProcessingMessage(data.message || "Ожидаем ответ Wildberries...");
        setStep("processing");
        break;
      case "supplier_select":
        setLegalEntities(
          data.legalEntities?.length
            ? data.legalEntities
            : (data.suppliers || []).map((name) => ({ id: `legacy:${name}`, name }))
        );
        setCurrentSupplier(data.currentSupplier || "");
        setStep("supplier_select");
        break;
      case "authenticated":
        fetch(`/api/wb/auth?ts=${Date.now()}`, { cache: "no-store" }).then(r => r.json()).then(d => {
          if (d.ok) {
            applyActiveSession(d);
          } else {
            setSessionActive(false);
            setError("Авторизация прошла, но токены не сохранились. Попробуйте ещё раз.");
            setStep("phone");
          }
        }).catch(() => {
          setSessionActive(true);
          setError("");
          setStep("authenticated");
        });
        break;
      default:
        setError(data.error || "Неожиданный ответ");
    }
  }

  async function handleSendPhone() {
    const cleaned = phone.replace(/[^\d+]/g, "");
    if (phoneCooldownSeconds > 0) {
      setError(`WB временно не даёт запросить новый SMS. Повтор через ${formatCooldown(phoneCooldownSeconds)}.`);
      return;
    }
    if (cleaned.length < 11) {
      setError("Введите корректный номер телефона");
      return;
    }

    setLoading(true);
    setError("");
    setProcessingMessage("Ожидаем ответ Wildberries...");

    try {
      const res = await fetch("/api/wb/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: cleaned }),
      });
      handleStepResult(await res.json());
    } catch {
      await recoverFromConnectionError();
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitCaptcha() {
    if (!captchaText.trim()) {
      setError("Введите текст с картинки");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/wb/auth/captcha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captcha: captchaText.trim() }),
      });
      handleStepResult(await res.json());
    } catch {
      await recoverFromConnectionError();
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitCode() {
    const cleaned = code.replace(/\D/g, "");
    if (cleaned.length < 4) {
      setError("Введите код из SMS");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/wb/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: cleaned }),
      });
      handleStepResult(await res.json());
    } catch {
      await recoverFromConnectionError();
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectSupplier(entityId: string) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/wb/auth/select-supplier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId }),
      });
      handleStepResult(await res.json());
    } catch {
      await recoverFromConnectionError();
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    setLoading(true);
    try {
      await fetch("/api/wb/auth", { method: "DELETE" });
    } catch {}
    setStep("phone");
    setPhone("+7 (");
    setCode("");
    setCaptchaText("");
    setCaptchaImage("");
    setLegalEntities([]);
    setError("");
    setSessionActive(false);
    setLoading(false);
  }

  function handleBack() {
    setStep("phone");
    setCode("");
    setCaptchaText("");
    setCaptchaImage("");
    setError("");
  }

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-medium">Авторизация WB</h3>
        {(step === "captcha" || step === "code" || step === "processing" || step === "supplier_select") && (
          <StepIndicator current={step} />
        )}
      </div>
      <AutoCheckLine channel="lk" liveOk={sessionActive} />

      {/* Error banner */}
      {error && (
        <div className="mb-4 rounded-lg p-3 text-sm bg-[var(--danger)]/10 text-[var(--danger)] border border-[var(--danger)]/20">
          {error}
        </div>
      )}

      {/* --- LOADING --- */}
      {step === "loading" && (
        <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <Spinner />
          Проверка сессии...
        </div>
      )}

      {/* --- PHONE INPUT --- */}
      {step === "phone" && (
        <div className="flex items-center gap-3">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(formatPhone(e.target.value))}
            placeholder="+7 (900) 123-45-67"
            maxLength={18}
            className="w-52 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm tracking-wide focus:outline-none focus:border-[var(--accent)] transition-colors"
            onKeyDown={(e) => e.key === "Enter" && handleSendPhone()}
            disabled={loading}
          />
          <button
            onClick={handleSendPhone}
            disabled={loading || phoneCooldownSeconds > 0}
            className="px-5 py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loading && <Spinner />}
            {loading ? "Подключение..." : phoneCooldownSeconds > 0 ? `Повтор через ${formatCooldown(phoneCooldownSeconds)}` : "Получить код"}
          </button>
        </div>
      )}

      {/* --- CAPTCHA --- */}
      {step === "captcha" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/5 p-3 text-sm text-[var(--warning)]">
            WB запросил капчу. Введите текст с картинки.
          </div>

          {captchaImage && (
            <div className="flex justify-center">
              <img
                src={`data:image/png;base64,${captchaImage}`}
                alt="Капча"
                className="rounded-lg border border-[var(--border)] max-w-full"
                style={{ imageRendering: "crisp-edges" }}
              />
            </div>
          )}

          <div className="flex items-center gap-3">
            <input
              ref={captchaRef}
              type="text"
              value={captchaText}
              onChange={(e) => setCaptchaText(e.target.value)}
              placeholder="Текст с картинки"
              className="w-48 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-center tracking-wider focus:outline-none focus:border-[var(--accent)] transition-colors"
              onKeyDown={(e) => e.key === "Enter" && handleSubmitCaptcha()}
              disabled={loading}
            />
            <button
              onClick={handleSubmitCaptcha}
              disabled={loading}
              className="px-5 py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {loading && <Spinner />}
              {loading ? "Отправка..." : "Отправить"}
            </button>
            <button onClick={handleBack} disabled={loading} className="btn-secondary">
              Назад
            </button>
          </div>
        </div>
      )}

      {/* --- SMS CODE --- */}
      {step === "code" && (
        <div className="space-y-3">
          <div className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-3 text-sm text-[var(--accent)]">
            SMS-код отправлен на <span className="font-medium">{phone}</span>
          </div>

          <div className="flex items-center gap-3">
            <input
              ref={codeRef}
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="Код из SMS"
              maxLength={6}
              className="w-40 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-base text-center tracking-widest focus:outline-none focus:border-[var(--accent)] transition-colors"
              onKeyDown={(e) => e.key === "Enter" && handleSubmitCode()}
              disabled={loading}
            />
            <button
              onClick={handleSubmitCode}
              disabled={loading}
              className="px-5 py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {loading && <Spinner />}
              {loading ? "Проверка..." : "Подтвердить"}
            </button>
            <button onClick={handleBack} disabled={loading} className="btn-secondary">
              Назад
            </button>
          </div>
        </div>
      )}

      {/* --- BACKGROUND AUTH PROCESSING --- */}
      {step === "processing" && (
        <div className="flex items-center gap-3 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-4 text-sm text-[var(--accent)]">
          <Spinner />
          <span>{processingMessage}</span>
        </div>
      )}

      {/* --- SUPPLIER SELECT --- */}
      {step === "supplier_select" && (
        <div className="space-y-3">
          <div className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-3 text-sm text-[var(--accent)]">
            Выберите юрлицо, под которым MPHub будет работать в WB. Выбор проверяется по ID кабинета перед сохранением.
          </div>

          <div className="space-y-2">
            {legalEntities.map((entity) => (
              <button
                key={entity.id}
                onClick={() => handleSelectSupplier(entity.id)}
                disabled={loading}
                className={`w-full text-left px-4 py-3 rounded-lg border text-sm transition-colors flex items-center justify-between gap-4 ${
                  entity.name === currentSupplier
                    ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                    : "border-[var(--border)] bg-[var(--bg)] text-[var(--text)] hover:border-[var(--accent)]/50"
                } disabled:opacity-50`}
              >
                <span className="min-w-0">
                  <span className="block font-medium">{entity.name}</span>
                  {entity.subtitle && (
                    <span className="mt-0.5 block text-xs font-normal text-[var(--text-muted)]">{entity.subtitle}</span>
                  )}
                </span>
                {entity.name === currentSupplier && <span className="shrink-0 text-xs text-[var(--text-muted)]">текущий</span>}
              </button>
            ))}
          </div>

          <button onClick={handleBack} disabled={loading} className="btn-secondary text-sm">
            Назад
          </button>
        </div>
      )}

      {/* --- AUTHENTICATED --- */}
      {step === "authenticated" && (
        <div className="space-y-3">
          {warning && (
            <div className="rounded-lg p-3 text-sm bg-[var(--warning)]/10 text-[var(--warning)] border border-[var(--warning)]/20">
              {warning}
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[var(--success)] animate-pulse" />
                <span className="text-xs text-[var(--text-muted)]">Статус</span>
                <span className="text-sm font-medium text-[var(--success)]">Активен</span>
              </div>
              {sessionInfo.supplier && (
                <div className="flex items-center gap-2 border-l border-[var(--border)] pl-4">
                  <span className="text-xs text-[var(--text-muted)]">Кабинет</span>
                  <span className="text-sm font-medium text-[var(--text)]">
                    {sessionInfo.supplier}
                    {(sessionInfo.storeName || sessionInfo.inn || sessionInfo.supplierId) && (
                      <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">
                        {[sessionInfo.storeName, sessionInfo.inn ? `ИНН ${sessionInfo.inn}` : "", sessionInfo.supplierId ? `ID ${sessionInfo.supplierId}` : ""].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                </div>
              )}
              {sessionInfo.phone && (
                <div className="flex items-center gap-2 border-l border-[var(--border)] pl-4">
                  <span className="text-xs text-[var(--text-muted)]">Телефон</span>
                  <span className="text-sm font-mono text-[var(--text)]">{sessionInfo.phone}</span>
                </div>
              )}
            </div>
            <button
              onClick={handleLogout}
              disabled={loading}
              className="px-4 py-2 border border-[var(--danger)]/30 text-[var(--danger)] text-sm rounded-lg font-medium hover:bg-[var(--danger)]/10 transition-colors disabled:opacity-50"
            >
              Выйти
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function normalizePhoneForCooldown(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("8") && digits.length === 11) digits = "7" + digits.slice(1);
  if (digits.startsWith("7") && digits.length === 11) digits = digits.slice(1);
  return digits;
}

function formatCooldown(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (minutes < 60) return `${minutes} мин.`;

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes > 0 ? `${hours} ч. ${restMinutes} мин.` : `${hours} ч.`;
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function StepIndicator({ current }: { current: "captcha" | "code" | "processing" | "supplier_select" }) {
  const steps = [
    { key: "phone", label: "Телефон" },
    { key: "code", label: "SMS" },
    { key: "supplier_select", label: "Кабинет" },
  ];

  const currentIdx = current === "supplier_select" ? 2 : 1;

  return (
    <div className="flex items-center gap-1.5 text-xs">
      {steps.map((s, i) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span
            className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
              i < currentIdx
                ? "bg-[var(--success)] text-white"
                : i === currentIdx
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--border)] text-[var(--text-muted)]"
            }`}
          >
            {i < currentIdx ? "✓" : i + 1}
          </span>
          <span className={i === currentIdx ? "text-[var(--text)]" : "text-[var(--text-muted)]"}>
            {s.label}
          </span>
          {i < steps.length - 1 && <span className="text-[var(--border)] mx-0.5">—</span>}
        </span>
      ))}
    </div>
  );
}
