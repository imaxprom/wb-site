"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
interface TaxSettings { usnRate: number; ndsRate: number; }

async function loadTaxSettings(): Promise<TaxSettings> {
  try {
    const res = await fetch("/api/finance/tax-settings");
    if (res.ok) return await res.json();
  } catch { /* ignore */ }
  return { usnRate: 1.0, ndsRate: 5.0 };
}

async function saveTaxSettings(settings: TaxSettings): Promise<void> {
  await fetch("/api/finance/tax-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

export default function TaxSettingsPage() {
  const [settings, setSettings] = useState<TaxSettings>({ usnRate: 1.0, ndsRate: 5.0 });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadTaxSettings().then(setSettings);
  }, []);

  async function handleChange(field: keyof TaxSettings, value: number) {
    const updated = { ...settings, [field]: value };
    setSettings(updated);
    await saveTaxSettings(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Link
              href="/finance"
              className="text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            >
              ← Назад к финансам
            </Link>
          </div>
          <h2 className="text-2xl font-bold mt-1">Настройки налогов</h2>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">
            Ставки УСН и НДС для расчёта P&amp;L
          </p>
        </div>
        {saved && (
          <span className="text-sm text-[var(--success)] font-medium">✅ Сохранено</span>
        )}
      </div>

      {/* Form */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-6 space-y-6">
        <h3 className="text-base font-medium text-[var(--text-muted)] uppercase tracking-wide">
          Налоговые ставки
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* УСН */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-[var(--text)]">
              Ставка УСН (%)
            </label>
            <input
              type="number"
              step="0.5"
              min="0"
              max="15"
              value={settings.usnRate}
              onChange={(e) => handleChange("usnRate", parseFloat(e.target.value) || 0)}
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
            />
            <p className="text-sm text-[var(--text-muted)]">База: (Стоимость реализованного товара после СПП − НДС)</p>
          </div>

          {/* НДС */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-[var(--text)]">
              Ставка НДС (%)
            </label>
            <input
              type="number"
              step="0.5"
              min="0"
              max="20"
              value={settings.ndsRate}
              onChange={(e) => handleChange("ndsRate", parseFloat(e.target.value) || 0)}
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
            />
            <p className="text-sm text-[var(--text-muted)]">База: Стоимость реализованного товара после СПП (НДС включён в цену)</p>
          </div>
        </div>
      </div>

      {/* Formulas explanation */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-6 space-y-4">
        <h3 className="text-base font-medium text-[var(--text-muted)] uppercase tracking-wide">
          Формулы расчёта
        </h3>
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <span className="text-[var(--danger)] font-mono text-sm font-bold mt-0.5">1</span>
            <div>
              <p className="text-sm text-[var(--text)]">
                <span className="font-semibold">НДС к уплате</span> = Стоимость после СПП × {settings.ndsRate}% / (100% + {settings.ndsRate}%)
              </p>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                НДС уже включён в цену продажи. Ставка {settings.ndsRate}% → эффективная нагрузка {(settings.ndsRate / (100 + settings.ndsRate) * 100).toFixed(3)}%
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-[var(--warning)] font-mono text-sm font-bold mt-0.5">2</span>
            <div>
              <p className="text-sm text-[var(--text)]">
                <span className="font-semibold">Очищаем базу от НДС</span> = Стоимость после СПП − НДС
              </p>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                Это налоговая база для расчёта УСН
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-[var(--success)] font-mono text-sm font-bold mt-0.5">3</span>
            <div>
              <p className="text-sm text-[var(--text)]">
                <span className="font-semibold">УСН</span> = (Стоимость после СПП − НДС) × {settings.usnRate}%
              </p>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                Ставка УСН {settings.usnRate}% от очищенной базы
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
