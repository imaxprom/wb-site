"use client";

import { useState, useEffect } from "react";
import { testApiKey, type ScopeResult } from "@/lib/wb-api";

export function ApiKeySettings() {
  const [key, setKey] = useState("");
  const [masked, setMasked] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [scopes, setScopes] = useState<ScopeResult[] | null>(null);
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Load key status from server
    fetch("/api/settings/apikey")
      .then((r) => r.json())
      .then((data) => {
        if (data.hasKey) {
          setHasKey(true);
          setMasked(data.masked);
          // Auto-check on load
          (async () => {
            setTesting(true);
            const result = await testApiKey();
            setTestOk(result.ok);
            setScopes(result.scopes);
            setTesting(false);
          })();
        }
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    if (!key.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/apikey", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim() }),
      });
      if (res.ok) {
        setHasKey(true);
        setMasked(key.length > 12 ? "••••••••••••" + key.slice(-8) : "••••••••");
        setKey("");
        setScopes(null);
        setTestOk(null);
      }
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleRemove = async () => {
    await fetch("/api/settings/apikey", { method: "DELETE" });
    setHasKey(false);
    setMasked("");
    setKey("");
    setScopes(null);
    setTestOk(null);
  };

  const handleTest = async () => {
    setTesting(true);
    setScopes(null);
    setTestOk(null);
    const result = await testApiKey();
    setTestOk(result.ok);
    setScopes(result.scopes);
    setTesting(false);
  };

  const granted = scopes?.filter((s) => s.ok) || [];
  const denied = scopes?.filter((s) => !s.ok) || [];

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
      <h3 className="font-medium mb-1">API-ключ Wildberries</h3>
      <p className="text-sm text-[var(--text-muted)] mb-4">
        Единый ключ из кабинета продавца WB. При генерации выберите нужные доступы.
      </p>

      {hasKey ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm font-mono text-[var(--text-muted)]">
              {masked}
            </div>
            <button
              onClick={handleTest}
              disabled={testing}
              className="px-4 py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {testing ? "Проверка..." : "Проверить"}
            </button>
            <button
              onClick={handleRemove}
              className="px-4 py-2.5 border border-[var(--danger)]/30 text-[var(--danger)] text-sm rounded-lg font-medium hover:bg-[var(--danger)]/10 transition-colors"
            >
              Удалить
            </button>
          </div>

          <div className="space-y-3">
            {testOk === false && scopes && (
              <div className="rounded-lg p-3 text-sm bg-[var(--danger)]/10 text-[var(--danger)]">
                Ключ не принят ни одним API. Проверьте правильность ключа.
              </div>
            )}

            <div>
              <p className="text-sm text-[var(--text-muted)] uppercase tracking-wide mb-2">
                Доступы {scopes ? `(${granted.length} из ${scopes.length})` : ""}
              </p>
              {testing && !scopes ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {["Контент", "Аналитика", "Продвижение", "Возвраты", "Документы", "Статистика", "Финансы", "Цены и скидки"].map((name) => (
                    <div key={name} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)] text-sm">
                      <span className="text-xs animate-spin">⏳</span>
                      <span>{name}</span>
                    </div>
                  ))}
                </div>
              ) : scopes ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {scopes.map((scope) => (
                    <div key={scope.name} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${scope.ok ? "border-[var(--success)]/30 bg-[var(--success)]/5 text-[var(--success)]" : "border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)]"}`}>
                      <span className="text-xs">{scope.ok ? "✅" : "⛔"}</span>
                      <span className={scope.ok ? "font-medium" : ""}>{scope.name}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {denied.length > 0 && granted.length > 0 && (
              <p className="text-sm text-[var(--text-muted)]">
                Для полного функционала рекомендуем включить: Контент, Продвижение, Возвраты, Финансы, Статистика, Цены и скидки, Аналитика
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Вставьте API-ключ"
            className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[var(--accent)]"
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
          <button
            onClick={handleSave}
            disabled={!key.trim() || saving}
            className="px-5 py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {saving ? "Сохранение..." : "Сохранить"}
          </button>
        </div>
      )}
    </div>
  );
}
