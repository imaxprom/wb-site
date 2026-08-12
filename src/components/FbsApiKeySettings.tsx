"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, KeyRound, Loader2, Trash2 } from "lucide-react";

export function FbsApiKeySettings() {
  const [key, setKey] = useState("");
  const [masked, setMasked] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetch("/api/settings/fbs-apikey", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        setHasKey(Boolean(payload.hasKey));
        setMasked(String(payload.masked || ""));
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Не удалось проверить FBS-токен"))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    if (!key.trim()) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/settings/fbs-apikey", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setHasKey(true);
      setMasked(String(payload.masked || "••••••••"));
      setKey("");
      setNotice(`Токен сохранён. Доступно складов: ${Number(payload.warehouseCount || 0)}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Не удалось сохранить FBS-токен");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm("Удалить отдельный FBS API-токен? Автоматизация остатков перестанет обращаться к WB.")) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/settings/fbs-apikey", { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setHasKey(false);
      setMasked("");
      setNotice("FBS API-токен удалён.");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Не удалось удалить FBS-токен");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-[var(--accent)]/10 p-2 text-[var(--accent)]"><KeyRound size={20} /></div>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium">FBS API-токен</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Используется в разделах «FBS Управление остатками» и «FBS Сборка». Создайте токен категории «Маркетплейс» с уровнем «Чтение и запись».
          </p>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin" /> Проверка настройки…</div>
      ) : hasKey ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="min-w-[240px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-2.5 font-mono text-sm text-[var(--text-muted)]">{masked}</div>
          <button type="button" onClick={() => setHasKey(false)} disabled={saving} className="rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">Заменить</button>
          <button type="button" onClick={() => void remove()} disabled={saving} className="flex items-center gap-2 rounded-lg border border-red-500/30 px-4 py-2.5 text-sm text-red-300 disabled:opacity-50"><Trash2 size={15} /> Удалить</button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-3">
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void save(); }}
            placeholder="Вставьте отдельный FBS API-токен"
            className="min-w-[280px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
          />
          <button type="button" onClick={() => void save()} disabled={!key.trim() || saving} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
            {saving && <Loader2 size={15} className="animate-spin" />} Сохранить и проверить
          </button>
        </div>
      )}

      {error && <div className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {notice && <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300"><CheckCircle2 size={16} /> {notice}</div>}
      <div className="mt-3 text-xs text-[var(--text-muted)]">
        Токен хранится отдельно для выбранного юрлица. Управление: <Link href="/fbs-stock" className="text-[var(--accent)] hover:underline">FBS Управление остатками</Link> · <Link href="/fbs" className="text-[var(--accent)] hover:underline">FBS Сборка</Link>.
      </div>
    </section>
  );
}
