"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowLeft, Star, Info } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface Account {
  id: number;
  name: string;
  store_name: string | null;
  inn: string | null;
  supplier_id: string | null;
  has_api_key: boolean;
  cookie_status: string;
  api_status: string;
  auto_replies: number;
  auto_dialogs: number;
  auto_complaints: number;
  use_auto_proxy: number;
  settings_json: string | null;
  has_wb_authorize_v3: boolean;
  has_wb_validation_key: boolean;
  wb_cookie_updated_at: string | null;
}

interface AccountSettingsProps {
  account: Account;
  onSave: (data: Partial<Account> & { settings_json?: string }) => void;
  saved?: boolean;
}

interface ComplaintsConfig {
  ratings: number[];
  allowed_reasons: number[];
  excluded_articles: string;
  daily_limit: number;
  delay_min_minutes: number;
  delay_max_minutes: number;
  system_prompt: string;
  user_prompt: string;
  managers: { name: string; style: string }[];
}

interface AccountCustomSettings {
  auto_reply_config?: Record<number, { enabled: boolean; mode: string; template: string }>;
  auto_reply_signature?: { enabled: boolean; text: string };
  auto_dialog_period?: number;
  auto_dialog_exclusions?: string;
  auto_dialog_config?: Record<number, { enabled: boolean; template: string }>;
  auto_complaints_config?: ComplaintsConfig;
}

const TABS = [
  { id: "connection", label: "Подключение" },
  { id: "auto-complaints", label: "Автожалобы" },
];

function StatusRow({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-[var(--text-muted)]">{label}</span>
      <span className={`text-sm font-medium ${active ? "text-green-400" : "text-red-400"}`}>
        {active ? "✅ Активен" : "❌ Неактивен"}
      </span>
    </div>
  );
}

function ToggleSwitch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <div
        onClick={() => onChange(!checked)}
        className={cn(
          "relative w-11 h-6 rounded-full transition-colors",
          checked ? "bg-[var(--accent)]" : "bg-[var(--border)]"
        )}
      >
        <div
          className={cn(
            "absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform",
            checked ? "translate-x-5.5" : "translate-x-0.5"
          )}
        />
      </div>
      {label && <span className="text-sm">{label}</span>}
    </label>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return <Star size={16} className={filled ? "text-amber-400 fill-amber-400" : "text-gray-600"} />;
}

// ─── Connection Tab ──────────────────────────────────────────

function SyncPanel() {
  const [status, setStatus] = useState({ total: 0, loaded: 0, status: "idle", message: "" });
  const [syncing, setSyncing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(() => {
    fetch("/api/reviews/sync-status").then(r => r.json()).then(setStatus).catch(() => {});
  }, []);

  useEffect(() => {
    poll();
    intervalRef.current = setInterval(poll, 2000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [poll, syncing]);

  const handleFullSync = () => {
    setShowConfirm(false);
    setSyncing(true);
    fetch("/api/reviews?sync=full").then(() => setSyncing(false)).catch(() => setSyncing(false));
  };

  const fmt = (n: number) => n.toLocaleString("ru-RU");
  const isSyncing = status.status === "syncing";
  const isDone = status.status === "done";
  const pct = status.total > 0 ? Math.round((status.loaded / status.total) * 100) : 0;

  return (
    <div className="space-y-3">
      <h3 className="font-medium">База отзывов</h3>
      <div className="text-sm">
        {isSyncing && (
          <span className="text-[var(--accent)]">
            {status.message || `Загрузка: ${fmt(status.loaded)} / ${status.total > 0 ? fmt(status.total) : "..."}`}
          </span>
        )}
        {isDone && (
          <span className="text-green-500">{status.message || `Загружено ${fmt(status.loaded)}`}</span>
        )}
        {status.status === "error" && (
          <span className="text-red-500">Ошибка: {status.message}</span>
        )}
        {!isSyncing && !isDone && status.status !== "error" && (
          <span className="text-[var(--text-muted)]">
            {status.loaded > 0 ? `В базе: ${fmt(status.loaded)}` : "Отзывы не загружены"}
          </span>
        )}
      </div>
      {(isSyncing || isDone) && (
        <div className="w-full bg-[var(--border)] rounded-full h-2 overflow-hidden">
          {isSyncing && pct === 0 ? (
            <div className="h-full bg-green-500 rounded-full animate-progress-indeterminate" />
          ) : (
            <div
              className="h-full bg-green-500 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${isDone ? 100 : pct}%` }}
            />
          )}
        </div>
      )}
      <div className="relative inline-block">
        <button
          onClick={() => setShowConfirm(true)}
          disabled={syncing}
          className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card-hover)] transition-colors disabled:opacity-50"
        >
          {syncing ? "Загрузка..." : "Полная загрузка"}
        </button>
        {showConfirm && (
          <div className="absolute left-0 bottom-full mb-2 w-72 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4 shadow-xl z-50">
            <p className="text-sm font-medium mb-2">Полная загрузка отзывов</p>
            <p className="text-xs text-[var(--text-muted)] mb-2">
              Эта операция загружает все отзывы из Wildberries с нуля. Используется только при первом подключении аккаунта.
            </p>
            <p className="text-xs text-[var(--text-muted)] mb-3">
              Повторный запуск не требуется — новые отзывы подгружаются автоматически каждые 10 минут.
            </p>
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={handleFullSync}
                className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
              >
                Да, загрузить
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="text-xs px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors"
              >
                Отмена
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ConnectionTab({ account, apiKey, setApiKey, useAutoProxy, setUseAutoProxy, wbAuthorizeV3, setWbAuthorizeV3, wbValidationKey, setWbValidationKey }: {
  account: Account; apiKey: string; setApiKey: (v: string) => void; useAutoProxy: boolean; setUseAutoProxy: (v: boolean) => void;
  wbAuthorizeV3: string; setWbAuthorizeV3: (v: string) => void; wbValidationKey: string; setWbValidationKey: (v: string) => void;
}) {
  const apiKeyActive = account.has_api_key || Boolean(apiKey.trim());
  const wbAuthorizeV3Active = account.has_wb_authorize_v3 || Boolean(wbAuthorizeV3.trim());
  const wbValidationKeyActive = account.has_wb_validation_key || Boolean(wbValidationKey.trim());

  return (
    <div className="space-y-6">
      {/* Account info + Sync panel */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium">Информация об аккаунте</h3>
          {account.wb_cookie_updated_at && (
            <span className="text-xs text-green-400">
              Кабинет обновлён: {new Date(account.wb_cookie_updated_at).toLocaleString("ru-RU")}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: account info */}
          <div className="grid grid-cols-2 gap-4 content-start">
            <div>
              <label className="text-xs text-[var(--text-muted)]">Название аккаунта</label>
              <p className="text-sm font-medium mt-0.5">{account.name}</p>
            </div>
            <div>
              <label className="text-xs text-[var(--text-muted)]">Название магазина</label>
              <p className="text-sm font-medium mt-0.5">{account.store_name || "—"}</p>
            </div>
            <div>
              <label className="text-xs text-[var(--text-muted)]">ИНН</label>
              <p className="text-sm font-medium mt-0.5">{account.inn || "—"}</p>
            </div>
            <div>
              <label className="text-xs text-[var(--text-muted)]">ID поставщика</label>
              <p className="text-sm font-medium mt-0.5">{account.supplier_id || "—"}</p>
            </div>
          </div>

          {/* Right: sync panel */}
          <div className="border-l border-[var(--border)] pl-6">
            <SyncPanel />
          </div>
        </div>

        {/* Keys + Statuses */}
        <div className="mt-4 pt-4 border-t border-[var(--border)] space-y-1">
          <div className="flex items-center gap-3 py-2">
            <span className="text-sm text-[var(--text-muted)] w-40 shrink-0">API-ключ</span>
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--text)] focus:outline-none focus:border-[var(--accent)] font-mono truncate"
              placeholder={account.has_api_key ? "Ключ настроен, вставьте новый для замены" : "Вставьте API-ключ..."}
            />
            <span className={`text-sm font-medium shrink-0 ${apiKeyActive ? "text-green-400" : "text-red-400"}`}>
              {apiKeyActive ? "✅ Активен" : "❌ Неактивен"}
            </span>
          </div>
          <div className="flex items-center gap-3 py-2">
            <span className="text-sm text-[var(--text-muted)] w-40 shrink-0">authorizev3</span>
            <input
              type="text"
              value={wbAuthorizeV3}
              onChange={(e) => setWbAuthorizeV3(e.target.value)}
              className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--text)] focus:outline-none focus:border-[var(--accent)] font-mono truncate"
              placeholder={account.has_wb_authorize_v3 ? "Токен настроен, вставьте новый для замены" : "DevTools → Network → заголовок authorizev3"}
            />
            <span className={`text-sm font-medium shrink-0 ${wbAuthorizeV3Active ? "text-green-400" : "text-red-400"}`}>
              {wbAuthorizeV3Active ? "✅ Активен" : "❌ Неактивен"}
            </span>
          </div>
          <div className="flex items-center gap-3 py-2">
            <span className="text-sm text-[var(--text-muted)] w-40 shrink-0">wbx-validation-key</span>
            <input
              type="text"
              value={wbValidationKey}
              onChange={(e) => setWbValidationKey(e.target.value)}
              className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--text)] focus:outline-none focus:border-[var(--accent)] font-mono truncate"
              placeholder={account.has_wb_validation_key ? "Ключ настроен, вставьте новый для замены" : "DevTools → Cookies → wbx-validation-key"}
            />
            <span className={`text-sm font-medium shrink-0 ${wbValidationKeyActive ? "text-green-400" : "text-red-400"}`}>
              {wbValidationKeyActive ? "✅ Активен" : "❌ Неактивен"}
            </span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-[var(--text-muted)]">Автоответы</span>
            <span className={`text-sm ${account.auto_replies ? "text-green-400" : "text-[var(--text-muted)]"}`}>
              {account.auto_replies ? "Вкл" : "Выкл"}
            </span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-[var(--text-muted)]">Автодиалоги</span>
            <span className={`text-sm ${account.auto_dialogs ? "text-green-400" : "text-[var(--text-muted)]"}`}>
              {account.auto_dialogs ? "Вкл" : "Выкл"}
            </span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-[var(--text-muted)]">Прокси</span>
            <span className="text-sm text-[var(--text-muted)]">Автопрокси</span>
          </div>
        </div>
      </div>

      {/* Proxy */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
        <h3 className="font-medium mb-3">Прокси</h3>
        <ToggleSwitch
          checked={useAutoProxy}
          onChange={setUseAutoProxy}
          label="Использовать автопрокси"
        />
        <p className="text-xs text-[var(--text-muted)] mt-2">
          Автоматический выбор прокси-сервера для стабильной работы с API Wildberries
        </p>
      </div>
    </div>
  );
}

// ─── Auto Replies Tab ────────────────────────────────────────

function AutoRepliesTab({ config, setConfig, signature, setSignature }: {
  config: Record<number, { enabled: boolean; mode: string; template: string }>;
  setConfig: (c: Record<number, { enabled: boolean; mode: string; template: string }>) => void;
  signature: { enabled: boolean; text: string };
  setSignature: (s: { enabled: boolean; text: string }) => void;
}) {
  return (
    <div className="space-y-6">
      {/* Description */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
        <h3 className="font-medium mb-2">Автоответы на отзывы</h3>
        <p className="text-sm text-[var(--text-muted)]">
          Автоматическое создание ответа на отзыв покупателя. Для каждой оценки можно выбрать
          генерацию ответа с помощью ИИ (GPT-4o-mini) или задать фиксированный текст.
        </p>
      </div>

      {/* 5 rating cards */}
      {[5, 4, 3, 2, 1].map((rating) => {
        const c = config[rating] || { enabled: false, mode: "ai", template: "" };
        return (
          <div key={rating} className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="flex">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <StarIcon key={i} filled={i <= rating} />
                  ))}
                </div>
                <span className="text-sm font-medium">Оценка {rating}</span>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={c.enabled}
                  onChange={(e) => setConfig({ ...config, [rating]: { ...c, enabled: e.target.checked } })}
                  className="accent-[var(--accent)]"
                />
                <span className="text-sm">Включить автоответ</span>
              </label>
            </div>

            {c.enabled && (
              <div className="space-y-3 mt-3 pt-3 border-t border-[var(--border)]">
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name={`mode-${rating}`}
                      checked={c.mode === "ai"}
                      onChange={() => setConfig({ ...config, [rating]: { ...c, mode: "ai" } })}
                      className="accent-[var(--accent)]"
                    />
                    <span className="text-sm">ИИ генерация</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name={`mode-${rating}`}
                      checked={c.mode === "fixed"}
                      onChange={() => setConfig({ ...config, [rating]: { ...c, mode: "fixed" } })}
                      className="accent-[var(--accent)]"
                    />
                    <span className="text-sm">Фиксированный текст</span>
                  </label>
                </div>
                {c.mode === "fixed" && (
                  <textarea
                    value={c.template}
                    onChange={(e) => setConfig({ ...config, [rating]: { ...c, template: e.target.value } })}
                    rows={3}
                    className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] resize-none"
                    placeholder="Шаблон ответа..."
                  />
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Signature */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
        <h3 className="font-medium mb-2">Подпись для автоответов</h3>
        <p className="text-sm text-[var(--text-muted)] mb-3">
          Общая подпись, добавляется ко всем автоответам
        </p>
        <label className="flex items-center gap-2 cursor-pointer mb-3">
          <input
            type="checkbox"
            checked={signature.enabled}
            onChange={(e) => setSignature({ ...signature, enabled: e.target.checked })}
            className="accent-[var(--accent)]"
          />
          <span className="text-sm">Добавлять подпись ко всем автоответам</span>
        </label>
        {signature.enabled && (
          <textarea
            value={signature.text}
            onChange={(e) => setSignature({ ...signature, text: e.target.value })}
            rows={2}
            className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] resize-none"
            placeholder="Текст подписи..."
          />
        )}
      </div>
    </div>
  );
}

// ─── Auto Dialogs Tab ────────────────────────────────────────

function AutoDialogsTab({ period, setPeriod, exclusions, setExclusions, config, setConfig }: {
  period: number; setPeriod: (v: number) => void;
  exclusions: string; setExclusions: (v: string) => void;
  config: Record<number, { enabled: boolean; template: string }>;
  setConfig: (c: Record<number, { enabled: boolean; template: string }>) => void;
}) {
  return (
    <div className="space-y-6">
      {/* Description */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
        <h3 className="font-medium mb-2">Автодиалоги с покупателями</h3>
        <p className="text-sm text-[var(--text-muted)]">
          Автоматическое сообщение покупателю в раздел Wildberries &quot;Чаты с покупателями&quot;.
          Можно создать собственное сообщение по шаблону, используя переменные. Работает для оценок 1-4.
        </p>
      </div>

      {/* Period slider */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
        <h3 className="font-medium mb-2">За какой период создавать автодиалоги</h3>
        <div className="flex items-center gap-4 mb-2">
          <input
            type="range"
            min={1}
            max={90}
            value={period}
            onChange={(e) => setPeriod(Number(e.target.value))}
            className="flex-1 accent-[var(--accent)]"
          />
          <span className="text-sm font-medium w-16 text-right">{period} дн.</span>
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          Количество дней за которое учитываются отзывы для создания автодиалога.
          Рекомендуемое значение: 10 дней. При первом включении функции с большим интервалом дней будет
          создано большое количество диалогов. Учитывайте это для распределения нагрузки на менеджеров.
        </p>
      </div>

      {/* Exclusions */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
        <h3 className="font-medium mb-2">Артикулы-исключения</h3>
        <textarea
          value={exclusions}
          onChange={(e) => setExclusions(e.target.value)}
          rows={2}
          className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] resize-none font-mono"
          placeholder="Например: 123456, 789012, 345678"
        />
        <p className="text-xs text-[var(--text-muted)] mt-1">
          Укажите артикулы товаров, для которых не нужно создавать автодиалоги. Можно вводить через запятую, пробел или любой другой разделитель.
        </p>
      </div>

      {/* 4 rating cards (1-4 only) */}
      {[4, 3, 2, 1].map((rating) => {
        const c = config[rating] || { enabled: false, template: "" };
        return (
          <div key={rating} className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="flex">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <StarIcon key={i} filled={i <= rating} />
                  ))}
                </div>
                <span className="text-sm font-medium">Оценка {rating}</span>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={c.enabled}
                  onChange={(e) => setConfig({ ...config, [rating]: { ...c, enabled: e.target.checked } })}
                  className="accent-[var(--accent)]"
                />
                <span className="text-sm">Включить автосообщение</span>
              </label>
            </div>

            {c.enabled && (
              <div className="mt-3 pt-3 border-t border-[var(--border)]">
                <textarea
                  value={c.template}
                  onChange={(e) => setConfig({ ...config, [rating]: { ...c, template: e.target.value } })}
                  rows={3}
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] resize-none"
                  placeholder="Шаблон сообщения. Используйте переменные: {buyer_name}, {product_name}, {rating}..."
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Auto Complaints Tab ─────────────────────────────────────

const COMPLAINT_REASONS = [
  { id: 11, label: "Отзыв не относится к товару" },
  { id: 12, label: "Отзыв оставили конкуренты", needsExplanation: true },
  { id: 13, label: "Спам-реклама в тексте" },
  { id: 16, label: "Нецензурная лексика" },
  { id: 18, label: "Отзыв с политическим контекстом" },
  { id: 20, label: "Угрозы, оскорбления" },
  { id: 19, label: "Другое", needsExplanation: true },
];

function AutoComplaintsTab({
  enabled,
  setEnabled,
  config,
  setConfig,
}: {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  config: ComplaintsConfig;
  setConfig: (c: ComplaintsConfig) => void;
}) {
  const toggleRating = (r: number) => {
    const ratings = config.ratings.includes(r)
      ? config.ratings.filter((x) => x !== r)
      : [...config.ratings, r].sort();
    setConfig({ ...config, ratings });
  };

  return (
    <div className="space-y-6">
      {/* Toggle */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
        <div className="flex items-center justify-between p-4 bg-[var(--bg)] rounded-lg border border-[var(--border)]">
          <div>
            <p className="text-sm font-medium">Автожалобы на отзывы</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Автоматическая отправка жалоб на негативные отзывы с целью их исключения из рейтинга.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-muted)]">{enabled ? "Вкл" : "Выкл"}</span>
            <ToggleSwitch checked={enabled} onChange={setEnabled} />
          </div>
        </div>
      </div>

      {/* Settings */}
      {enabled && (
        <>
          {/* Settings — 3 columns */}
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
            <h3 className="font-medium mb-4">Настройки автожалоб</h3>
            <div className="grid grid-cols-1 lg:grid-cols-[auto_auto_auto_auto_1fr_auto_1fr] gap-0">
              {/* Col 1: Ratings */}
              <div className="pr-5">
                <label className="text-xs text-[var(--text-muted)] mb-2 block">Оценки</label>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4, 5].map((r) => (
                    <button
                      key={r}
                      onClick={() => toggleRating(r)}
                      className={cn(
                        "w-9 h-9 rounded-lg border text-xs font-medium transition-colors",
                        config.ratings.includes(r)
                          ? "bg-[var(--accent)] border-[var(--accent)] text-white"
                          : "bg-[var(--bg)] border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)]"
                      )}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* Divider */}
              <div className="hidden lg:block w-px bg-[var(--border)]" />

              {/* Col 2: Limits */}
              <div className="lg:px-5 pt-4 lg:pt-0 border-t lg:border-t-0 border-[var(--border)] space-y-3">
                <div>
                  <label className="text-xs text-[var(--text-muted)] mb-1 block">Количество жалоб в день</label>
                  <div className="flex items-center gap-1.5">
                    <input type="number" min={1} max={200} value={config.daily_limit}
                      onChange={(e) => setConfig({ ...config, daily_limit: Number(e.target.value) || 50 })}
                      className="w-16 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]" />
                    <span className="text-xs text-[var(--text-muted)] invisible">— </span>
                    <span className="w-16 invisible" />
                    <span className="text-xs invisible shrink-0">мин</span>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-[var(--text-muted)] mb-1 block">Задержка между жалобами</label>
                  <div className="flex items-center gap-1.5">
                    <input type="number" min={1} max={60} value={config.delay_min_minutes}
                      onChange={(e) => setConfig({ ...config, delay_min_minutes: Number(e.target.value) || 1 })}
                      className="w-16 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]" />
                    <span className="text-xs text-[var(--text-muted)]">—</span>
                    <input type="number" min={1} max={60} value={config.delay_max_minutes}
                      onChange={(e) => setConfig({ ...config, delay_max_minutes: Number(e.target.value) || 10 })}
                      className="w-16 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]" />
                    <span className="text-xs text-[var(--text-muted)] shrink-0">мин</span>
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="hidden lg:block w-px bg-[var(--border)]" />

              {/* Col 2: Reasons */}
              <div className="lg:px-5 pt-4 lg:pt-0 border-t lg:border-t-0 border-[var(--border)]">
                <label className="text-xs text-[var(--text-muted)] mb-2 block">Причины (ИИ выберет лучшую)</label>
                <div className="space-y-1.5">
                  {COMPLAINT_REASONS.map((r) => {
                    const checked = config.allowed_reasons.includes(r.id);
                    return (
                      <label key={r.id} className="flex items-center gap-2 cursor-pointer group">
                        <input type="checkbox" checked={checked}
                          onChange={() => {
                            const reasons = checked
                              ? config.allowed_reasons.filter((x) => x !== r.id)
                              : [...config.allowed_reasons, r.id];
                            if (reasons.length > 0) setConfig({ ...config, allowed_reasons: reasons });
                          }}
                          className="accent-[var(--accent)] w-3.5 h-3.5" />
                        <span className="text-xs group-hover:text-[var(--text)] text-[var(--text-muted)] transition-colors">{r.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Divider */}
              <div className="hidden lg:block w-px bg-[var(--border)]" />

              {/* Col 3: Exclusions */}
              <div className="lg:pl-5 pt-4 lg:pt-0 border-t lg:border-t-0 border-[var(--border)]">
                <label className="text-xs text-[var(--text-muted)] mb-2 block">Исключения по артикулам</label>
                <textarea
                  value={config.excluded_articles}
                  onChange={(e) => setConfig({ ...config, excluded_articles: e.target.value })}
                  rows={6}
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] resize-none"
                  placeholder={"Каждый артикул\nс новой строки\n\n123456789\n987654321"}
                />
              </div>
            </div>
          </div>

          {/* Managers */}
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
            <h3 className="font-medium mb-2">Менеджеры</h3>
            <p className="text-sm text-[var(--text-muted)] mb-4">
              Обращения пишутся от имени разных менеджеров. Каждый имеет свой стиль — ротация автоматическая.
            </p>
            <div className="space-y-3">
              {config.managers.map((m, i) => (
                <div key={i} className="bg-[var(--bg)] rounded-lg border border-[var(--border)] p-3">
                  <div className="flex items-center justify-between mb-2">
                    <input
                      type="text"
                      value={m.name}
                      onChange={(e) => {
                        const managers = [...config.managers];
                        managers[i] = { ...m, name: e.target.value };
                        setConfig({ ...config, managers });
                      }}
                      className="bg-transparent text-sm font-medium text-[var(--text)] focus:outline-none border-b border-transparent focus:border-[var(--accent)] w-32"
                    />
                    {config.managers.length > 1 && (
                      <button
                        onClick={() => setConfig({ ...config, managers: config.managers.filter((_, j) => j !== i) })}
                        className="text-xs text-[var(--text-muted)] hover:text-red-400 transition-colors"
                      >
                        Удалить
                      </button>
                    )}
                  </div>
                  <textarea
                    value={m.style}
                    onChange={(e) => {
                      const managers = [...config.managers];
                      managers[i] = { ...m, style: e.target.value };
                      setConfig({ ...config, managers });
                    }}
                    rows={2}
                    className="w-full bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-[var(--text)] focus:outline-none focus:border-[var(--accent)] resize-none"
                    placeholder="Описание стиля менеджера..."
                  />
                </div>
              ))}
            </div>
            <button
              onClick={() => setConfig({ ...config, managers: [...config.managers, { name: "Новый", style: "" }] })}
              className="mt-3 text-xs px-3 py-1.5 rounded-lg border border-dashed border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors w-full"
            >
              + Добавить менеджера
            </button>
          </div>

          {/* AI Prompts */}
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
            <h3 className="font-medium mb-2">Промпт для ИИ</h3>
            <p className="text-sm text-[var(--text-muted)] mb-4">
              Opus 4.6 генерирует текст обращения по этим промптам. Оставьте пустым для использования стандартного.
            </p>

            <div className="space-y-4">
              <div>
                <label className="text-sm text-[var(--text-muted)] mb-1.5 block">Системный промпт</label>
                <textarea
                  value={config.system_prompt}
                  onChange={(e) => setConfig({ ...config, system_prompt: e.target.value })}
                  rows={4}
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] resize-y font-mono"
                  placeholder="Ты — менеджер бренда IMSI — бренд женского нижнего белья на маркетплейсе Wildberries..."
                />
              </div>
              <div>
                <label className="text-sm text-[var(--text-muted)] mb-1.5 block">
                  Пользовательский промпт
                  <span className="text-[var(--text-muted)] opacity-60 ml-2">
                    Переменные: {"{product_name}"}, {"{product_article}"}, {"{rating}"}, {"{review_text}"}, {"{reasons_list}"}
                  </span>
                </label>
                <textarea
                  value={config.user_prompt}
                  onChange={(e) => setConfig({ ...config, user_prompt: e.target.value })}
                  rows={12}
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] resize-y font-mono"
                  placeholder={`Ты — менеджер бренда IMSI (женское нижнее бельё) на Wildberries.\n\nПокупатель оставил негативный отзыв без каких-либо доказательств...\n\nОтзыв покупателя:\n- Товар: {product_name} (арт. {product_article})\n- Оценка: {rating}/5\n- Текст: {review_text}\n- Фото/видео: отсутствуют\n\nКатегории формы обращения (выбери одну):\n{reasons_list}\n\nСоставь пояснение к обращению (4-5 предложений)...\n\nОтвет — строго JSON, одной строкой:\n{"reason_id": <число>, "explanation": "<пояснение>"}`}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Other Tab ───────────────────────────────────────────────

function OtherTab() {
  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5 flex items-center justify-center min-h-[200px]">
      <div className="text-center">
        <Info size={32} className="mx-auto text-[var(--text-muted)] mb-3" />
        <p className="text-[var(--text-muted)] text-sm">В разработке</p>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────

export function AccountSettings({ account, onSave, saved }: AccountSettingsProps) {
  const [activeTab, setActiveTab] = useState("connection");
  const [apiKey, setApiKey] = useState("");
  const [useAutoProxy, setUseAutoProxy] = useState(account.use_auto_proxy === 1);
  const [wbAuthorizeV3, setWbAuthorizeV3] = useState("");
  const [wbValidationKey, setWbValidationKey] = useState("");

  // Parse stored settings
  const stored: AccountCustomSettings = (() => {
    try { return account.settings_json ? JSON.parse(account.settings_json) : {}; }
    catch { return {}; }
  })();

  const [replyConfig, setReplyConfig] = useState<Record<number, { enabled: boolean; mode: string; template: string }>>(
    stored.auto_reply_config || {}
  );
  const [signature, setSignature] = useState(stored.auto_reply_signature || { enabled: false, text: "" });
  const [dialogPeriod, setDialogPeriod] = useState(stored.auto_dialog_period || 90);
  const [dialogExclusions, setDialogExclusions] = useState(stored.auto_dialog_exclusions || "");
  const [dialogConfig, setDialogConfig] = useState<Record<number, { enabled: boolean; template: string }>>(
    stored.auto_dialog_config || {}
  );
  const [complaintsEnabled, setComplaintsEnabled] = useState(account.auto_complaints === 1);
  const [complaintsConfig, setComplaintsConfig] = useState<ComplaintsConfig>(
    {
      ratings: [1, 2],
      allowed_reasons: [11, 13, 16, 20],
      excluded_articles: "",
      daily_limit: 50,
      delay_min_minutes: 1,
      delay_max_minutes: 10,
      managers: [
        { name: "Анна", style: "Коротко, сухо, по фактам. 2 предложения. Без эмоций, только суть." },
        { name: "Дмитрий", style: "Эмоциональный, переживает за бренд. 4-5 предложений. Подчёркивает ущерб от необоснованных отзывов." },
        { name: "Елена", style: "Юрист. Ссылается на правила площадки и регламент. Формальный деловой стиль. 3-4 предложения." },
        { name: "Максим", style: "Новичок. Пишет просто и по-человечески. Без канцеляризмов. 3 предложения." },
        { name: "Ольга", style: "Опытный менеджер. Аргументирует через статистику продаж, количество заказов, процент возвратов. 3-4 предложения." },
        { name: "Сергей", style: "Логик. Разбирает отзыв по пунктам, находит противоречия в словах покупателя. Холодный анализ. 3 предложения." },
        { name: "Марина", style: "Заботливая. Выражает сожаление, что покупатель недоволен, но мягко указывает на отсутствие подтверждений. Вежливый тон. 4 предложения." },
        { name: "Артём", style: "Прямолинейный. Пишет резко и по делу, без вводных слов. Каждое предложение — отдельный аргумент. 2-3 предложения." },
        { name: "Наталья", style: "Дотошная. Обращает внимание на мелочи: дату покупки, отсутствие фото, размерную сетку. Много конкретики. 4-5 предложений." },
        { name: "Иван", style: "Разговорный стиль. Пишет как в переписке — без официоза, с обращением к модератору на «вы». Короткие фразы. 3 предложения." },
      ],
      system_prompt: "Ты — сотрудник бренда IMSI (женское нижнее бельё) на Wildberries. Ты составляешь обращения к модератору по отзывам покупателей. Пиши как живой человек. Отвечай только JSON.",
      user_prompt: `Составь обращение к модератору Wildberries по отзыву покупателя.

Отзыв:
- Товар: {product_name} (арт. {product_article})
- Оценка: {rating}/5
- Текст: {review_text}
- Фото/видео от покупателя: нет

Категории обращения (выбери одну):
{reasons_list}

Правила:
- НЕ используй фразы: «голословный», «добросовестный продавец», «просим модератора рассмотреть», «принять решение об удалении», «вводит в заблуждение», «наносит ущерб репутации», «на всех этапах», «бездоказательный», «потенциальных покупателей», «репутационный ущерб»
- Реагируй на содержание конкретного отзыва, а не по шаблону:
  * отзыв пустой → отсутствие содержания, нарушение правил площадки
  * есть текст но нет фото → нет подтверждения заявленному
  * эмоциональный отзыв → субъективная оценка без конкретики
  * претензия к размеру/качеству → неправильный подбор размера, несоблюдение рекомендаций по уходу

Ответ — строго JSON, одной строкой:
{"reason_id": <число>, "explanation": "<текст обращения>"}`,
      ...stored.auto_complaints_config,
    }
  );

  function handleSave() {
    const settingsJson = JSON.stringify({
      auto_reply_config: replyConfig,
      auto_reply_signature: signature,
      auto_dialog_period: dialogPeriod,
      auto_dialog_exclusions: dialogExclusions,
      auto_dialog_config: dialogConfig,
      auto_complaints_config: complaintsConfig,
    });

    const payload: Partial<Account> & {
      settings_json?: string;
      api_key?: string;
      wb_authorize_v3?: string;
      wb_validation_key?: string;
    } = {
      use_auto_proxy: useAutoProxy ? 1 : 0,
      auto_complaints: complaintsEnabled ? 1 : 0,
      settings_json: settingsJson,
    };

    if (apiKey.trim()) payload.api_key = apiKey.trim();
    if (wbAuthorizeV3.trim()) payload.wb_authorize_v3 = wbAuthorizeV3.trim();
    if (wbValidationKey.trim()) payload.wb_validation_key = wbValidationKey.trim();

    onSave(payload);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/reviews/accounts"
          className="flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors mb-3"
        >
          <ArrowLeft size={16} />
          Назад
        </Link>
        <h2 className="text-2xl font-bold">Настройки аккаунта</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">{account.name} — {account.store_name || "Не указан"}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[var(--bg-card)] rounded-lg p-1 border border-[var(--border)]">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 py-2 rounded-md text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card-hover)]"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "connection" && (
        <ConnectionTab
          account={account}
          apiKey={apiKey}
          setApiKey={setApiKey}
          useAutoProxy={useAutoProxy}
          setUseAutoProxy={setUseAutoProxy}
          wbAuthorizeV3={wbAuthorizeV3}
          setWbAuthorizeV3={setWbAuthorizeV3}
          wbValidationKey={wbValidationKey}
          setWbValidationKey={setWbValidationKey}
        />
      )}
      {activeTab === "auto-complaints" && (
        <AutoComplaintsTab
          enabled={complaintsEnabled}
          setEnabled={setComplaintsEnabled}
          config={complaintsConfig}
          setConfig={setComplaintsConfig}
        />
      )}
      {/* Footer */}
      <div className="flex items-center justify-end pt-4 border-t border-[var(--border)]">
        <button
          onClick={handleSave}
          className={cn(
            "font-medium px-6 py-2.5 rounded-lg text-sm transition-all duration-300",
            saved
              ? "bg-green-500 text-white"
              : "bg-[var(--text)] text-[var(--bg)] hover:opacity-90"
          )}
        >
          {saved ? "✓ Сохранено" : "Сохранить все настройки"}
        </button>
      </div>
    </div>
  );
}
