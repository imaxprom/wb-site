"use client";

import { useEffect, useState } from "react";
import { Building2, CheckCircle2, Loader2, Save } from "lucide-react";

type OrganizationsPayload = {
  activeOrganizationId: number;
  organizations: Array<{ id: number; displayName: string }>;
};

export function FbsOrganizationNameSettings() {
  const [organizationId, setOrganizationId] = useState(0);
  const [name, setName] = useState("");
  const [savedName, setSavedName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetch("/api/fbs-portal/organizations", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as Partial<OrganizationsPayload> & { error?: string };
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        const activeId = Number(payload.activeOrganizationId || 0);
        const active = payload.organizations?.find((organization) => organization.id === activeId);
        setOrganizationId(activeId);
        setName(active?.displayName || "");
        setSavedName(active?.displayName || "");
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить название юрлица"))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    const displayName = name.trim().replace(/\s+/g, " ");
    if (!organizationId || !displayName) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/fbs-portal/organizations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, displayName }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; displayName?: string };
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      const nextName = String(payload.displayName || displayName);
      setName(nextName);
      setSavedName(nextName);
      setNotice("Название сохранено и обновлено в переключателе.");
      window.dispatchEvent(new CustomEvent("fbs-organization-renamed", {
        detail: { organizationId, displayName: nextName },
      }));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Не удалось сохранить название юрлица");
    } finally {
      setSaving(false);
    }
  }

  return <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
    <div className="flex items-start gap-3">
      <div className="rounded-lg bg-[var(--accent)]/10 p-2 text-[var(--accent)]"><Building2 size={20} /></div>
      <div className="min-w-0 flex-1">
        <h3 className="font-medium">Название юрлица</h3>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Отображается в переключателе справа и помогает сотрудникам выбрать нужный кабинет.</p>
      </div>
    </div>
    {loading ? <div className="mt-4 flex items-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin" />Загрузка…</div> : <div className="mt-4 flex flex-wrap gap-3">
      <input value={name} onChange={(event) => { setName(event.target.value); setNotice(""); }} onKeyDown={(event) => { if (event.key === "Enter") void save(); }} maxLength={120} className="min-w-[280px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-2.5 outline-none focus:border-[var(--accent)]" placeholder="Название юрлица" />
      <button type="button" onClick={() => void save()} disabled={saving || !name.trim() || name.trim().replace(/\s+/g, " ") === savedName} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-5 py-2.5 font-medium text-white disabled:opacity-45">{saving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}Сохранить</button>
    </div>}
    {error && <div className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
    {notice && <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300"><CheckCircle2 size={16} />{notice}</div>}
  </section>;
}
