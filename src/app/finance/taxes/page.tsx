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
            Укажите ваши ставки УСН и НДС — от них зависит расчёт чистой прибыли в отчёте
          </p>
        </div>
        {saved && (
          <span className="text-sm text-[var(--success)] font-medium">✅ Сохранено</span>
        )}
      </div>

      {/* Form */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-6 space-y-6">
        <h3 className="text-base font-medium text-[var(--text-muted)] uppercase tracking-wide">
          Ваши налоговые ставки
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
            <p className="text-sm text-[var(--text-muted)]">Упрощённый налог на доход от продаж. Считается от суммы реализации за вычетом НДС. «Доходы»: обычно 6%, но с 2025 года ставка может быть 1–6% в зависимости от региона и оборота. Уточните вашу ставку в налоговой или у бухгалтера</p>
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
            <p className="text-sm text-[var(--text-muted)]">Налог на добавленную стоимость, уже включён в розничную цену товара. С 2025 года для УСН с оборотом выше 60 млн ₽: 5% или 7%. Для ОСНО: 20% (большинство товаров), 10% (детские, продукты). Если вы на УСН с оборотом до 60 млн ₽ — ставьте 0%</p>
          </div>
        </div>
      </div>

      {/* Formulas explanation */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-6 space-y-4">
        <h3 className="text-base font-medium text-[var(--text-muted)] uppercase tracking-wide">
          Как считаются налоги в отчёте
        </h3>
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <span className="text-[var(--danger)] font-mono text-sm font-bold mt-0.5">1</span>
            <div>
              <p className="text-sm text-[var(--text)]">
                <span className="font-semibold">Шаг 1 · НДС к уплате</span> = Сумма реализации × {settings.ndsRate} ÷ (100 + {settings.ndsRate})
              </p>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                НДС уже включён в розничную цену, поэтому он «извлекается» из суммы, а не начисляется сверху. При ставке {settings.ndsRate}% реальная налоговая нагрузка составит {(settings.ndsRate / (100 + settings.ndsRate) * 100).toFixed(2)}% от выручки
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-[var(--warning)] font-mono text-sm font-bold mt-0.5">2</span>
            <div>
              <p className="text-sm text-[var(--text)]">
                <span className="font-semibold">Шаг 2 · Налоговая база УСН</span> = Сумма реализации − НДС
              </p>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                Из выручки вычитается НДС, чтобы не платить налог на налог. Оставшаяся сумма — это доход, с которого считается УСН
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-[var(--success)] font-mono text-sm font-bold mt-0.5">3</span>
            <div>
              <p className="text-sm text-[var(--text)]">
                <span className="font-semibold">Шаг 3 · УСН к уплате</span> = (Сумма реализации − НДС) × {settings.usnRate}%
              </p>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                Итоговая сумма УСН: {settings.usnRate}% от дохода, очищенного от НДС. Оба налога (НДС + УСН) вычитаются из выручки при расчёте чистой прибыли
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
