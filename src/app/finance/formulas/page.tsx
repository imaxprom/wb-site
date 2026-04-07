"use client";

import Link from "next/link";

// ─── Data ───────────────────────────────────────────────────

const FORMULAS = [
  { title: "Реализация", formula: "Продажи − Возвраты", source: "sale_dt", note: "Цена уже со скидкой покупателя" },
  { title: "Комиссия WB", formula: "(Продажи − К выплате) − (Возвраты − К выплате возвр.)", source: "sale_dt", note: "Включает СПП и эквайринг" },
  { title: "Логистика", formula: "Σ delivery_rub", source: "rr_dt", note: "" },
  { title: "Остальные услуги", formula: "Хранение + Штрафы + Приёмка + Джем + Обратная логистика (rebill)", source: "rr_dt", note: "Джем = подписка WB" },
  { title: "Реклама", formula: "Σ расходов по всем кампаниям", source: "дата расхода", note: "Данные точные, без задержки" },
  { title: "Себестоимость", formula: "Σ (закупка × кол-во продаж) − Σ (закупка × возвраты)", source: "rr_dt", note: "По баркодам из настроек" },
  { title: "НДС (5%)", formula: "К выплате × 5 / 105", source: "расчёт", note: "НДС включён в цену! Не × 5%" },
  { title: "УСН (1%)", formula: "(К выплате − НДС) × 1%", source: "расчёт", note: "Сначала НДС, потом УСН" },
  { title: "Все услуги", formula: "Комиссия + Логистика + Реклама + Остальные", source: "сумма", note: "Всё что удержал WB" },
  { title: "Прибыль", formula: "Реал. − Усл. − Себ. − НДС − УСН", source: "итог", note: "Операционная, без ФОТ/аренды" },
];

const METRICS = [
  { title: "Маржинальность", formula: "Прибыль / Реализация × 100%", good: "> 20%", warn: "10–20%", bad: "< 10%" },
  { title: "Рентабельность", formula: "Прибыль / Себестоимость × 100%", good: null, warn: null, bad: null },
  { title: "ДРР", formula: "Реклама / Реализация × 100%", good: "< 10%", warn: "10–15%", bad: "> 15%" },
  { title: "Прибыль / шт", formula: "Прибыль / Кол-во проданных (нетто)", good: null, warn: null, bad: null },
];

const VERIFICATION = [
  { m: "Реализация", d: "−0.05%" },
  { m: "Комиссия", d: "+0.02%" },
  { m: "Логистика", d: "−0.06%" },
  { m: "Реклама", d: "0.00%" },
  { m: "Себестоимость", d: "−0.05%" },
  { m: "Прибыль", d: "−0.5%" },
];

const NUANCES = [
  { q: "Почему даты продаж и услуг разные?", a: "Продажи по sale_dt (дата покупки), услуги по rr_dt (дата отчёта WB). Может быть другая неделя." },
  { q: "Почему НДС = ×5/105, а не ×5%?", a: "НДС включён в цену. 1050₽ × 5/105 = 50₽. Если ×5% = 52.50₽ — ошибка." },
  { q: "Почему данные отстают 1-3 дня?", a: "WB формирует отчёт понедельно с задержкой. Последние дни могут быть неполными." },
  { q: "Что такое «К выплате» (ppvz)?", a: "Сумма, которую WB переводит нам. Цена − комиссия − СПП − эквайринг. От неё считаются налоги." },
  { q: "Почему себест. по умолч. 300₽?", a: "Заглушка для незаполненных баркодов. Заполните всё в Финансы → Себестоимость." },
  { q: "Это полная прибыль бизнеса?", a: "Нет — операционная. Без ФОТ, аренды, фото, транспорта до склада WB." },
];

// ─── Component ──────────────────────────────────────────────

export default function FormulasPage() {
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">📐 Формулы и расчёты</h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">Все формулы финансового отчёта · Сверено с ЛК WB (точность 99.5%+)</p>
        </div>
        <Link href="/finance" className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-white transition-colors">
          ← К отчёту
        </Link>
      </div>

      {/* Row 1: Dependency map (left) + Verification (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Dependency map — 2 cols */}
        <div className="lg:col-span-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
          <h2 className="text-sm font-bold text-white mb-2">🗺 Карта зависимостей</h2>
          <div className="font-mono text-[11px] leading-relaxed space-y-0.5">
            <div className="text-[var(--success)]">📦 Продажи − ↩️ Возвраты</div>
            <div className="text-[var(--text)] font-bold">═ 💰 РЕАЛИЗАЦИЯ</div>
            <div className="text-[var(--text-muted)] pl-4">↓ минус</div>
            <div className="text-[var(--warning)] pl-4">📊 Комиссия + 🚚 Логистика + 📢 Реклама + 📦 Хранение/Штрафы/Приёмка/Джем/Rebill</div>
            <div className="text-[var(--text)] pl-4 font-bold">═ 🏭 ВСЕ УСЛУГИ WB</div>
            <div className="text-[var(--text-muted)] pl-4">↓ минус</div>
            <div className="text-[var(--accent)] pl-4">🏷️ Себестоимость + 🧾 НДС (ppvz × 5/105) + 🧾 УСН ((ppvz − НДС) × 1%)</div>
            <div className="text-[var(--text-muted)] pl-4">↓ равно</div>
            <div className="text-[var(--success)] font-bold text-xs">✅ ПРИБЫЛЬ = Реализация − Все услуги − Себестоимость − НДС − УСН</div>
            <div className="text-[var(--text-muted)] mt-1 text-[10px]">
              📈 Маржа = Прибыль ÷ Реализация &nbsp;·&nbsp; 📈 Рентаб. = Прибыль ÷ Себест. &nbsp;·&nbsp; 📈 ДРР = Реклама ÷ Реализация
            </div>
          </div>
        </div>

        {/* Verification — 1 col */}
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
          <h2 className="text-sm font-bold text-white mb-2">✅ Сверка с ЛК WB</h2>
          <p className="text-[10px] text-[var(--text-muted)] mb-2">2–22 марта 2026</p>
          <div className="space-y-1.5">
            {VERIFICATION.map((v) => (
              <div key={v.m} className="flex justify-between items-center text-xs">
                <span className="text-[var(--text-muted)]">{v.m}</span>
                <span className="text-[var(--success)] font-mono text-[11px]">{v.d} ✅</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Row 2: Formulas grid — 2 cols on md, 3 on xl */}
      <div>
        <h2 className="text-sm font-bold text-white mb-3">📊 Формулы расчёта</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-3">
          {FORMULAS.map((f) => (
            <div key={f.title} className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-3">
              <h3 className="text-white font-semibold text-xs">{f.title}</h3>
              <div className="mt-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2 py-1.5">
                <code className="text-[var(--accent)] text-[11px] font-mono leading-tight block">{f.formula}</code>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                <span className="px-1.5 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)]">📅 {f.source}</span>
              </div>
              {f.note && (
                <p className="mt-1.5 text-[10px] text-[var(--warning)] leading-snug">💡 {f.note}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Row 3: Metrics (left) + Nuances (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Metrics */}
        <div>
          <h2 className="text-sm font-bold text-white mb-3">📈 Показатели эффективности</h2>
          <div className="grid grid-cols-2 gap-3">
            {METRICS.map((m) => (
              <div key={m.title} className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-3">
                <h3 className="text-white font-semibold text-xs">{m.title}</h3>
                <div className="mt-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2 py-1.5">
                  <code className="text-[var(--accent)] text-[11px] font-mono">{m.formula}</code>
                </div>
                {m.good && (
                  <div className="mt-1.5 flex flex-wrap gap-1 text-[10px]">
                    <span className="px-1.5 py-0.5 rounded bg-[var(--success)]/10 text-[var(--success)]">{m.good} ✅</span>
                    <span className="px-1.5 py-0.5 rounded bg-[var(--warning)]/10 text-[var(--warning)]">{m.warn} ⚠️</span>
                    <span className="px-1.5 py-0.5 rounded bg-[var(--danger)]/10 text-[var(--danger)]">{m.bad} ❌</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Nuances */}
        <div>
          <h2 className="text-sm font-bold text-white mb-3">❓ Важные нюансы</h2>
          <div className="grid grid-cols-1 gap-2">
            {NUANCES.map((n, i) => (
              <div key={i} className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-3 py-2">
                <p className="text-xs text-white font-medium">{n.q}</p>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-snug">{n.a}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <p className="text-center text-[10px] text-[var(--text-muted)] py-2 border-t border-[var(--border)]">
        Формулы верифицированы 25.03.2026 · Чак, финансовый аналитик MpHub
      </p>
    </div>
  );
}
