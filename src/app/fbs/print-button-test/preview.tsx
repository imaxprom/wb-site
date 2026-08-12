"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Printer } from "lucide-react";

const OPTIONS = [
  { id: 1, title: "Классический", description: "По центру, максимально понятно" },
  { id: 2, title: "С разделителем", description: "Два ряда визуально отделены" },
  { id: 3, title: "Светлая нижняя часть", description: "Количество читается отдельным блоком" },
  { id: 4, title: "Мягкая карточка", description: "Спокойный вариант без резких границ" },
  { id: 5, title: "Акцентное число", description: "Количество заметнее действия" },
  { id: 6, title: "Иконка в круге", description: "Крупная и удобная зона действия" },
  { id: 7, title: "Левое выравнивание", description: "Ближе к интерфейсу складской системы" },
  { id: 8, title: "Контурная", description: "Менее яркая в длинной таблице" },
  { id: 9, title: "Глубокий синий", description: "Контрастное разделение двух рядов" },
  { id: 10, title: "Минималистичная", description: "Только действие и крупное число" },
] as const;

function PrintButton({ variant, selected, onClick }: { variant: number; selected: boolean; onClick: () => void }) {
  const shared = "group relative flex min-h-[96px] w-full max-w-[280px] cursor-pointer flex-col overflow-hidden rounded-xl font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--accent)]/25 active:scale-[0.98]";
  const icon = <Printer size={22} className="shrink-0 transition-transform group-hover:scale-110" />;

  if (variant === 1) return <button type="button" onClick={onClick} aria-pressed={selected} className={`${shared} justify-center gap-2 bg-[var(--accent)] px-6 py-4 text-white shadow-sm hover:brightness-110 hover:shadow-lg`}><span className="flex items-center justify-center gap-2 text-lg">{icon}Печать</span><span className="text-2xl font-bold tabular-nums">12</span></button>;
  if (variant === 2) return <button type="button" onClick={onClick} aria-pressed={selected} className={`${shared} border border-[var(--accent)] bg-[var(--accent)] text-white shadow-sm hover:shadow-lg`}><span className="flex flex-1 items-center justify-center gap-2 text-lg">{icon}Печать</span><span className="flex min-h-[42px] items-center justify-center border-t border-white/25 bg-black/10 text-2xl font-bold tabular-nums">12</span></button>;
  if (variant === 3) return <button type="button" onClick={onClick} aria-pressed={selected} className={`${shared} border border-[var(--accent)] bg-[var(--accent)] text-white shadow-sm hover:-translate-y-0.5 hover:shadow-lg`}><span className="flex flex-1 items-center justify-center gap-2 text-lg">{icon}Печать</span><span className="flex min-h-[42px] items-center justify-center bg-white text-2xl font-extrabold tabular-nums text-[var(--accent)]">12</span></button>;
  if (variant === 4) return <button type="button" onClick={onClick} aria-pressed={selected} className={`${shared} justify-center gap-1 border border-[var(--accent)]/25 bg-[var(--accent)]/10 px-6 py-4 text-[var(--accent)] hover:border-[var(--accent)]/60 hover:bg-[var(--accent)]/15`}><span className="flex items-center justify-center gap-2 text-lg">{icon}Печать</span><span className="text-3xl font-extrabold tabular-nums">12</span></button>;
  if (variant === 5) return <button type="button" onClick={onClick} aria-pressed={selected} className={`${shared} border border-[var(--accent)] bg-[var(--accent)] px-5 py-3 text-white shadow-sm hover:shadow-lg`}><span className="flex flex-1 items-center justify-center gap-2 text-base">{icon}Печать</span><span className="flex flex-1 items-center justify-center rounded-lg bg-white/15 text-3xl font-black tabular-nums">12</span></button>;
  if (variant === 6) return <button type="button" onClick={onClick} aria-pressed={selected} className={`${shared} justify-center gap-2 bg-[var(--accent)] px-5 py-3 text-white shadow-sm hover:brightness-110 hover:shadow-lg`}><span className="flex items-center justify-center gap-3 text-lg"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15">{icon}</span>Печать</span><span className="text-2xl font-bold tabular-nums">12</span></button>;
  if (variant === 7) return <button type="button" onClick={onClick} aria-pressed={selected} className={`${shared} items-start justify-center gap-1 bg-[var(--accent)] px-7 py-4 text-left text-white shadow-sm hover:brightness-110 hover:shadow-lg`}><span className="flex items-center gap-2 text-lg">{icon}Печать</span><span className="pl-[30px] text-3xl font-extrabold tabular-nums">12</span></button>;
  if (variant === 8) return <button type="button" onClick={onClick} aria-pressed={selected} className={`${shared} justify-center gap-1 border-2 border-[var(--accent)] bg-transparent px-6 py-4 text-[var(--accent)] hover:bg-[var(--accent)]/10`}><span className="flex items-center justify-center gap-2 text-lg">{icon}Печать</span><span className="text-3xl font-extrabold tabular-nums">12</span></button>;
  if (variant === 9) return <button type="button" onClick={onClick} aria-pressed={selected} className={`${shared} bg-gradient-to-b from-blue-600 to-blue-800 px-6 py-3 text-white shadow-md hover:-translate-y-0.5 hover:shadow-xl`}><span className="flex flex-1 items-center justify-center gap-2 text-lg">{icon}Печать</span><span className="flex flex-1 items-center justify-center border-t border-white/20 text-3xl font-black tabular-nums">12</span></button>;
  return <button type="button" onClick={onClick} aria-pressed={selected} className={`${shared} justify-center gap-1 bg-[var(--accent)] px-6 py-4 text-white hover:brightness-110`}><span className="flex items-center justify-center gap-2 text-base font-medium">{icon}Печать</span><span className="text-4xl font-black leading-none tabular-nums">12</span></button>;
}

export function PrintButtonPreview() {
  const [selected, setSelected] = useState(1);

  return <main className="mx-auto max-w-[1320px] space-y-6 pb-14">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="mb-2 inline-flex rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-500">Только localhost · на принтер ничего не отправляется</div>
        <h1 className="text-2xl font-bold">10 вариантов кнопки «Печать»</h1>
        <p className="mt-2 max-w-[780px] text-sm leading-relaxed text-[var(--text-muted)]">Все кнопки шире рабочего варианта, имеют два ряда и увеличенную область нажатия. Число везде показано без слова «штук».</p>
      </div>
      <Link href="/fbs" className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm transition hover:bg-[var(--bg-card-hover)]">Вернуться в FBS</Link>
    </header>

    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 text-sm"><strong>Тестовое количество: 12 этикеток.</strong> Нажмите на понравившийся вариант — карточка отметится зелёной рамкой.</div>

    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {OPTIONS.map((option) => {
        const active = selected === option.id;
        return <article key={option.id} className={`relative flex min-h-[230px] flex-col rounded-2xl border bg-[var(--bg-card)] p-5 transition ${active ? "border-emerald-500 ring-2 ring-emerald-500/15" : "border-[var(--border)]"}`}>
          {active && <span className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-white"><Check size={17} /></span>}
          <div className="pr-10"><div className="text-base font-semibold">Вариант {option.id}. {option.title}</div><div className="mt-1 text-sm text-[var(--text-muted)]">{option.description}</div></div>
          <div className="flex flex-1 items-center justify-center pt-5"><PrintButton variant={option.id} selected={active} onClick={() => setSelected(option.id)} /></div>
        </article>;
      })}
    </section>

    <div className="sticky bottom-4 flex items-center justify-between gap-4 rounded-xl border border-emerald-500/30 bg-emerald-950/95 px-5 py-3 text-emerald-100 shadow-2xl backdrop-blur"><span>Выбран вариант <strong>№{selected}</strong></span><span className="text-sm text-emerald-300">Тестовый макет — рабочая страница не изменена</span></div>
  </main>;
}
