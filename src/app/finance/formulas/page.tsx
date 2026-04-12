"use client";

import Link from "next/link";

// ─── Data ───────────────────────────────────────────────────

const FORMULAS = [
  {
    title: "Реализация",
    formula: "Продажи − Возвраты",
    source: "Еженедельные отчёты WB",
    note: "Итоговая выручка за период. Считается как сумма проданных товаров (цена со скидкой) минус сумма возвращённых товаров. Это главный показатель выручки, от которого считаются все проценты",
  },
  {
    title: "Продажи",
    formula: "Сумма всех продаж за выбранный период (цена товара со скидкой покупателя × количество)",
    source: "Еженедельные отчёты WB",
    note: "Это полная сумма продаж ДО вычета возвратов. Отличие от реализации: продажи — только приход, без учёта возвратов",
  },
  {
    title: "Возвраты",
    formula: "Сумма всех возвращённых товаров за период (цена со скидкой × количество возвратов)",
    source: "Еженедельные отчёты WB",
    note: "Товары, которые покупатели вернули. Вычитаются из продаж при расчёте реализации",
  },
  {
    title: "Комиссия WB",
    formula: "Разница между ценой продажи и суммой к выплате продавцу — по продажам и возвратам отдельно. То есть: (Цена продажи − Сумма к выплате по продажам) − (Цена возврата − Сумма к выплате по возвратам)",
    source: "Еженедельные отчёты WB",
    note: "Включает комиссию площадки, СПП (скидку постоянного покупателя) и эквайринг. Это всё, что WB забирает за обработку заказа",
  },
  {
    title: "Логистика",
    formula: "Сумма всех расходов на доставку товаров покупателям за период",
    source: "Еженедельные отчёты WB",
    note: "Стоимость доставки каждой единицы товара, которую удерживает WB",
  },
  {
    title: "Реклама",
    formula: "Сумма расходов по всем рекламным кампаниям за выбранный период",
    source: "Рекламный кабинет WB",
    note: "Данные загружаются напрямую из рекламного кабинета, без задержки",
  },
  {
    title: "Остальные услуги",
    formula: "Хранение на складе + Штрафы + Приёмка товара",
    source: "Еженедельные отчёты WB",
    note: "Всё что WB удерживает помимо комиссии, логистики и рекламы. Джем (подписка) считается отдельно",
  },
  {
    title: "Джем",
    formula: "Сумма удержаний по подписке «Джем» за период",
    source: "Еженедельные отчёты WB",
    note: "Подписка WB для продавцов. Считается отдельно от остальных услуг, потому что это фиксированный платёж, а не процент от продаж",
  },
  {
    title: "Все услуги",
    formula: "Комиссия WB + Логистика + Реклама + Остальные услуги + Джем",
    source: "Сумма всех расходов на услуги",
    note: "Итого: всё, что удержал и забрал WB за период. Это полная стоимость работы через маркетплейс",
  },
  {
    title: "Налог (УСН)",
    formula: "(Сумма реализации товара − НДС) × ставка УСН",
    source: "Настройки налогов",
    note: "Упрощённый налог считается от суммы реализации товара (retail_amount — поле «Вайлдберриз реализовал Товар») за вычетом НДС — так вы не платите налог на налог. Ставка зависит от региона и режима: «Доходы» — от 1% до 6%, «Доходы минус расходы» — от 5% до 15%. Укажите вашу ставку в настройках налогов",
  },
  {
    title: "НДС к уплате",
    formula: "Сумма реализации товара × ставка НДС ÷ (100 + ставка НДС)",
    source: "Настройки налогов",
    note: "НДС считается от суммы реализации товара (retail_amount — поле «Вайлдберриз реализовал Товар»), а не от цены продажи. НДС уже включён в эту сумму, поэтому извлекается делением: 1050₽ × 5 ÷ 105 = 50₽. С 2025 года для УСН с оборотом выше 60 млн ₽ действуют ставки 5% или 7%",
  },
  {
    title: "Себестоимость",
    formula: "Закупочная цена × количество проданных товаров − Закупочная цена × количество возвратов",
    source: "Справочник себестоимости (Финансы → Себестоимость)",
    note: "Закупочные цены берутся из справочника по баркодам. Если баркод не заполнен — используется значение по умолчанию (300₽). Заполните все баркоды для точного расчёта",
  },
  {
    title: "Операционная прибыль",
    formula: "Реализация − Все услуги WB − Себестоимость − НДС − Налог (УСН)",
    source: "Итоговый расчёт",
    note: "Это операционная прибыль — без учёта ФОТ, аренды, фотосессий, транспорта до склада WB и других внешних расходов",
  },
  {
    title: "Маржинальность (%)",
    formula: "Операционная прибыль ÷ Реализация × 100%",
    source: "Итоговый расчёт",
    note: "Показывает, какая доля выручки остаётся как прибыль",
  },
  {
    title: "Рентабельность (%)",
    formula: "Операционная прибыль ÷ Себестоимость × 100%",
    source: "Итоговый расчёт",
    note: "Показывает, сколько прибыли приносит каждый вложенный в товар рубль",
  },
];

const METRICS = [
  { title: "Маржинальность", formula: "Прибыль ÷ Реализация × 100%", good: "> 20%", warn: "10–20%", bad: "< 10%" },
  { title: "Рентабельность", formula: "Прибыль ÷ Себестоимость × 100%", good: null, warn: null, bad: null },
  { title: "ДРР (доля рекламных расходов)", formula: "Реклама ÷ Реализация × 100%", good: "< 10%", warn: "10–15%", bad: "> 15%" },
  { title: "Прибыль на штуку", formula: "Прибыль ÷ Количество проданных (за вычетом возвратов)", good: null, warn: null, bad: null },
];


const NUANCES = [
  { q: "Почему даты продаж и услуг могут не совпадать?", a: "Продажи считаются по дате покупки, а услуги (логистика, хранение) — по дате отчёта WB. Они могут попасть в разные недели." },
  { q: "Почему НДС считается делением, а не умножением?", a: "НДС уже включён в сумму реализации товара (retail_amount). Чтобы извлечь его, нужно делить: 1050₽ × 5 ÷ 105 = 50₽. Если умножить 1050 × 5% = 52.50₽ — это переплата на 2.50₽ с каждой единицы." },
  { q: "Почему данные отстают на 1–3 дня?", a: "За завершённые недели используются Excel-отчёты WB (эталон). За текущую незавершённую неделю — данные из API (могут быть неполными). При появлении нового Excel-отчёта данные за эту неделю автоматически уточняются." },
  { q: "Что такое «Сумма к выплате продавцу»?", a: "Это сумма, которую WB переводит вам на расчётный счёт после удержания комиссии, СПП и эквайринга. Важно: налоги (УСН и НДС) считаются от суммы реализации товара (retail_amount), а не от цены продажи и не от суммы к выплате." },
  { q: "Почему себестоимость показывает 300₽ по умолчанию?", a: "Это заглушка для баркодов, у которых не заполнена закупочная цена. Заполните все баркоды в разделе Финансы → Себестоимость." },
  { q: "Это полная прибыль бизнеса?", a: "Нет — это операционная прибыль. Без учёта зарплат, аренды, фотосессий, транспорта до склада WB и прочих внешних расходов." },
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
        {/* Dependency map — left */}
        <div className="lg:col-span-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
          <h2 className="text-sm font-bold text-white mb-2">🗺 Карта зависимостей</h2>
          <div className="font-mono text-[11px] leading-relaxed space-y-0.5">
            <div className="text-[var(--success)]">📦 Продажи − ↩️ Возвраты</div>
            <div className="text-[var(--text)] font-bold">═ 💰 РЕАЛИЗАЦИЯ</div>
            <div className="text-[var(--text-muted)] pl-4">↓ минус</div>
            <div className="text-[var(--warning)] pl-4">📊 Комиссия WB + 🚚 Логистика + 📢 Реклама + 📦 Хранение/Штрафы/Приёмка + 🎫 Джем</div>
            <div className="text-[var(--text)] pl-4 font-bold">═ 🏭 ВСЕ УСЛУГИ WB</div>
            <div className="text-[var(--text-muted)] pl-4">↓ минус</div>
            <div className="text-[var(--accent)] pl-4">🏷️ Себестоимость + 🧾 НДС (реализация × ставка ÷ (100 + ставка)) + 🧾 УСН ((реализация − НДС) × ставка)</div>
            <div className="text-[var(--text-muted)] pl-4">↓ равно</div>
            <div className="text-[var(--success)] font-bold text-xs">✅ ПРИБЫЛЬ = Реализация − Все услуги − Себестоимость − НДС − УСН</div>
            <div className="text-[var(--text-muted)] mt-1 text-[10px]">
              📈 Маржа = Прибыль ÷ Реализация &nbsp;·&nbsp; 📈 Рентаб. = Прибыль ÷ Себест. &nbsp;·&nbsp; 📈 ДРР = Реклама ÷ Реализация
            </div>
          </div>
        </div>

        {/* Metrics — right */}
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
          <h2 className="text-sm font-bold text-white mb-2">📈 Показатели эффективности</h2>
          <div className="space-y-3">
            {METRICS.map((m) => (
              <div key={m.title}>
                <h3 className="text-white font-semibold text-xs">{m.title}</h3>
                <div className="mt-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2 py-1.5">
                  <code className="text-[var(--accent)] text-[11px] font-mono">{m.formula}</code>
                </div>
                {m.good && (
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                    <span className="px-1.5 py-0.5 rounded bg-[var(--success)]/10 text-[var(--success)]">{m.good} ✅</span>
                    <span className="px-1.5 py-0.5 rounded bg-[var(--warning)]/10 text-[var(--warning)]">{m.warn} ⚠️</span>
                    <span className="px-1.5 py-0.5 rounded bg-[var(--danger)]/10 text-[var(--danger)]">{m.bad} ❌</span>
                  </div>
                )}
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

      {/* Row 3: Nuances */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

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
        Формулы обновлены 09.04.2026 · Сверены с кодом расчётов MpHub
      </p>
    </div>
  );
}
