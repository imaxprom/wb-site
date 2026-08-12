"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, QrCode, Save } from "lucide-react";

export function FbsMarkingSettings() {
  const [enabled, setEnabled] = useState(true);
  const [saved, setSaved] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetch("/api/settings/fbs-marking", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as { forceUnderwearSgtin?: boolean; error?: string };
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        const value = payload.forceUnderwearSgtin !== false;
        setEnabled(value);
        setSaved(value);
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить настройку маркировки"))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/settings/fbs-marking", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceUnderwearSgtin: enabled }),
      });
      const payload = await response.json().catch(() => ({})) as { forceUnderwearSgtin?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      const value = payload.forceUnderwearSgtin !== false;
      setEnabled(value);
      setSaved(value);
      setNotice(value
        ? "Для трусов обязательная маркировка включена."
        : "Принудительная маркировка отключена; явное требование WB сохранит защиту.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Не удалось сохранить настройку маркировки");
    } finally {
      setSaving(false);
    }
  }

  return <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
    <div className="flex items-start gap-3">
      <div className="rounded-lg bg-amber-500/10 p-2 text-amber-500"><QrCode size={20} /></div>
      <div className="min-w-0 flex-1">
        <h3 className="font-medium">Маркировка трусов</h3>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Настройка действует только для выбранного юрлица.</p>
      </div>
    </div>
    {loading ? <div className="mt-4 flex items-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin" />Загрузка…</div> : <div className="mt-4 flex flex-wrap items-center gap-4">
      <label className="flex min-w-[280px] flex-1 cursor-pointer items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3">
        <input type="checkbox" checked={enabled} onChange={(event) => { setEnabled(event.target.checked); setNotice(""); }} className="h-5 w-5 accent-[var(--accent)]" />
        <span><span className="block font-medium">Обязательная маркировка «Честный знак»</span><span className="mt-0.5 block text-sm text-[var(--text-muted)]">Если выключено, обычные трусы пропускают этап маркировки. Явное обязательное требование WB отключить нельзя.</span></span>
      </label>
      <button type="button" onClick={() => void save()} disabled={saving || enabled === saved} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-5 py-2.5 font-medium text-white disabled:opacity-45">{saving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}Сохранить</button>
    </div>}
    {error && <div className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
    {notice && <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300"><CheckCircle2 size={16} />{notice}</div>}
  </section>;
}
