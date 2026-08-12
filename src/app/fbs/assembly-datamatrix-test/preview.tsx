"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Printer, QrCode, ScanLine, X } from "lucide-react";
import { getWbImageUrl } from "@/lib/wb-image";

const PROCESSING_LABELS = [
  "56676777811",
  "56676777936",
  "56676778042",
  "56676778157",
  "56676778263",
  "56676778378",
  "56676778484",
  "56676778599",
  "56676778705",
];

const BATCH_LABELS = [...PROCESSING_LABELS, "56676778810"];

function HighlightedLabel({ value }: { value: string }) {
  const prefix = value.slice(0, -4);
  const suffix = value.slice(-4);
  return <span className="inline-flex items-baseline whitespace-nowrap font-mono font-semibold tracking-wide"><span>{prefix}</span><span className="ml-2 text-lg font-extrabold text-[var(--accent)]">{suffix}</span></span>;
}

function Counter({ value, label, tone, onClick }: { value: number; label: string; tone: "success" | "pending" | "error"; onClick?: () => void }) {
  const colors = tone === "success"
    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-500"
    : tone === "pending"
      ? "border-amber-500/25 bg-amber-500/10 text-amber-500"
      : "border-red-500/25 bg-red-500/10 text-red-500";
  const content = <>
    <div className="w-14 shrink-0 text-left text-3xl font-black leading-none tabular-nums">{value}</div>
    <div className="min-w-0 text-left text-sm font-semibold">{label}</div>
  </>;
  return onClick
    ? <button type="button" onClick={onClick} className={`flex min-h-[68px] items-center rounded-xl border px-4 py-3 text-left transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 ${colors}`}>{content}</button>
    : <div className={`flex min-h-[68px] items-center rounded-xl border px-4 py-3 ${colors}`}>{content}</div>;
}

function playErrorTone() {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = 190;
    gain.gain.setValueAtTime(0.12, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.42);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.42);
    oscillator.addEventListener("ended", () => void context.close(), { once: true });
  } catch {
    // Красное предупреждение остаётся доступным, если браузер запретил звук.
  }
}

export function AssemblyDataMatrixPreview() {
  const [detailsPanel, setDetailsPanel] = useState<"accepted" | "processing" | "errors" | null>(null);
  const [labelScanned, setLabelScanned] = useState(false);
  const [printState, setPrintState] = useState<"idle" | "printing" | "printed">("idle");
  const [printRemaining, setPrintRemaining] = useState(10);
  const [scanSessionActive, setScanSessionActive] = useState(false);
  const [pairedLabels, setPairedLabels] = useState<string[]>([]);
  const [scanError, setScanError] = useState("");

  useEffect(() => {
    const existed = document.documentElement.classList.contains("fbs-readable-ui");
    document.documentElement.classList.add("fbs-readable-ui");
    return () => { if (!existed) document.documentElement.classList.remove("fbs-readable-ui"); };
  }, []);

  useEffect(() => {
    if (!detailsPanel) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setDetailsPanel(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [detailsPanel]);

  useEffect(() => {
    if (printState !== "printing") return;
    if (printRemaining <= 0) {
      setPrintState("printed");
      return;
    }
    const timer = window.setTimeout(() => setPrintRemaining((current) => Math.max(0, current - 1)), 500);
    return () => window.clearTimeout(timer);
  }, [printRemaining, printState]);

  const resetPrintSimulation = () => {
    setPrintState("idle");
    setPrintRemaining(10);
    setScanSessionActive(false);
    setLabelScanned(false);
    setPairedLabels([]);
    setScanError("");
  };

  const currentBatchLabel = BATCH_LABELS[pairedLabels.length] || "";
  const batchComplete = pairedLabels.length === BATCH_LABELS.length;

  const simulateCorrectLabel = () => {
    if (!scanSessionActive || batchComplete) return;
    if (labelScanned) {
      setScanError(`Сначала отсканируйте «Честный знак» для этикетки ${currentBatchLabel}`);
      playErrorTone();
      return;
    }
    setLabelScanned(true);
    setScanError("");
  };

  const simulateCorrectMark = () => {
    if (!scanSessionActive || batchComplete) return;
    if (!labelScanned) {
      setScanError("Сначала отсканируйте этикетку WB на товаре");
      playErrorTone();
      return;
    }
    setPairedLabels((current) => [...current, currentBatchLabel]);
    setLabelScanned(false);
    setScanError("");
  };

  const simulateWrongScan = () => {
    if (!scanSessionActive || batchComplete) return;
    setScanError(labelScanned
      ? `Отсканирована следующая этикетка WB. Сначала нужен «Честный знак» для ${currentBatchLabel}`
      : "Это не этикетка WB из активной пачки");
    playErrorTone();
  };

  return <main className="mx-auto max-w-[1500px] space-y-5 pb-12">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="mb-2 inline-flex rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-500">Только localhost · данные учебные</div>
        <h1 className="text-2xl font-bold">Эмуляция маркировки при сборке</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Поставка и заказы WB не изменяются. Макет предназначен только для согласования интерфейса.</p>
      </div>
      <Link href="/fbs/grouped-assembly-test" className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm transition hover:bg-[var(--bg-card-hover)]">Макет группировки товаров</Link>
    </header>

    <section className="grid gap-2 md:grid-cols-4">
      {[
        { title: "1. Новые заказы", value: "0 новых" },
        { title: "2. Сборка", value: "38/46", active: true },
        { title: "3. Маркировка", value: "14/24" },
        { title: "4. Отгрузка", value: "контроль" },
      ].map((step) => <button key={step.title} type="button" className={`relative rounded-xl border px-4 py-3 text-left ${step.active ? "border-[var(--accent)] bg-[var(--accent)]/10 shadow-sm" : "border-[var(--border)] bg-[var(--bg-card)]"}`}>
        <div className="font-semibold">{step.title}</div>
        <div className="text-sm text-[var(--text-muted)]">{step.value}</div>
      </button>)}
    </section>

    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <div className="w-full max-w-[760px]">
        <label className="mb-1 block text-sm text-[var(--text-muted)]">Рабочая поставка</label>
        <select className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2" defaultValue="demo">
          <option value="demo">Домодедово — FBS — 10.08.2026 · 46 шт.</option>
        </select>
      </div>
    </section>

    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-semibold">2. Сборка товара</h2>
        <div className="flex gap-2"><button type="button" disabled className="cursor-not-allowed rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-2 text-sm font-medium text-[var(--text-muted)] opacity-45">Штучно</button><button type="button" className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white">Пачками</button></div>
      </div>

      <div id="demo-pair-scanner" className="scroll-mt-6 rounded-xl border-2 border-amber-500/45 bg-amber-500/5 p-4">
        <div className="flex items-center gap-2 text-lg font-semibold"><QrCode className="text-amber-500" size={22} />Маркировка при сборке</div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className={`rounded-xl border px-4 py-3 ${batchComplete ? "border-emerald-500/35 bg-emerald-500/10" : scanSessionActive ? "border-amber-500/35 bg-amber-500/10" : "border-[var(--border)] bg-[var(--bg)]"}`}><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="font-semibold">Пачка: 10 одинаковых товаров</div><div className="text-sm text-[var(--text-muted)]">{batchComplete ? "Все товары попарно отсканированы" : scanSessionActive ? labelScanned ? `Этикетка ${currentBatchLabel} найдена — ожидается «Честный знак»` : "Ожидается этикетка WB со следующего товара" : "Сначала напечатайте пачку и нажмите «Маркировать 10»"}</div></div><div className={`text-3xl font-black tabular-nums ${batchComplete ? "text-emerald-500" : "text-amber-500"}`}>{pairedLabels.length}<span className="text-xl text-[var(--text-muted)]">/10</span></div></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--bg-card)]"><div className={`h-full rounded-full transition-all duration-200 ${batchComplete ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${pairedLabels.length * 10}%` }} /></div><div aria-hidden={pairedLabels.length !== 9} className={`mt-3 flex h-[48px] items-center rounded-lg bg-red-500/10 px-3 font-semibold text-red-500 ${pairedLabels.length === 9 ? "visible" : "invisible"}`}>Остался 1 товар — пачка не завершена</div></div>
          <div className="grid min-w-[320px] grid-cols-2 gap-2"><button type="button" onClick={simulateCorrectLabel} disabled={!scanSessionActive || batchComplete} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-35">Тест: этикетка WB</button><button type="button" onClick={simulateCorrectMark} disabled={!scanSessionActive || batchComplete} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-35">Тест: Честный знак</button><button type="button" onClick={simulateWrongScan} disabled={!scanSessionActive || batchComplete} className="col-span-2 rounded-lg border border-red-500/35 bg-red-500/5 px-3 py-2 text-sm font-medium text-red-500 transition hover:bg-red-500/10 disabled:opacity-35">Тест: неправильное сканирование</button></div>
        </div>

        <div aria-live="assertive" className={`mt-3 flex h-[68px] items-center rounded-xl border px-4 text-sm font-semibold transition-colors ${scanError ? "border-red-500/40 bg-red-500/10 text-red-500" : "invisible border-transparent"}`}>{scanError || "Место для сообщения об ошибке"}</div>

        <div className="mt-4 grid items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_210px]">
          <div className={`flex h-[330px] flex-col overflow-hidden rounded-xl border bg-[var(--bg)] p-4 lg:h-[280px] ${labelScanned ? "border-[var(--accent)]/50" : "border-[var(--border)]"}`}>
            <div aria-hidden={!labelScanned} className={`mb-3 flex items-center gap-3 rounded-lg bg-[var(--bg-card)] p-3 transition-opacity duration-150 ${labelScanned ? "opacity-100" : "pointer-events-none invisible opacity-0"}`}>
              <div className="flex h-[120px] w-[90px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={getWbImageUrl(398657691, "small")} alt="Трусы женские хлопковые" className="h-full w-full object-contain" />
              </div>
              <div className="min-w-0"><div className="mb-1 inline-flex rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-500">Этикетка WB найдена</div><div className="font-semibold">Трусы женские хлопковые, комплект 8 шт.</div><div className="mt-1 text-sm text-[var(--text-muted)]">Артикул sl-8338-mc-9 · размер 46–48</div><div className="mt-1"><HighlightedLabel value={currentBatchLabel || BATCH_LABELS[0]} /></div></div>
            </div>

            <form onSubmit={(event) => { event.preventDefault(); if (labelScanned) simulateCorrectMark(); else simulateCorrectLabel(); }} className="mt-auto flex gap-2">
              <input autoFocus className="min-w-0 flex-1 rounded-lg border-2 border-[var(--accent)]/45 bg-[var(--bg-card)] px-4 py-3 font-mono text-lg outline-none focus:border-[var(--accent)]" placeholder={labelScanned ? "Отсканируйте «Честный знак»" : "Отсканируйте этикетку WB"} autoComplete="off" />
              <button type="submit" className="flex min-w-[150px] items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 font-medium text-white"><ScanLine size={19} />Сканировать</button>
              <button type="button" onClick={() => { setLabelScanned(false); setScanError(""); }} tabIndex={labelScanned ? 0 : -1} aria-hidden={!labelScanned} className={`shrink-0 rounded-lg border border-[var(--border)] px-4 py-3 text-sm font-medium transition-opacity duration-150 ${labelScanned ? "opacity-100" : "pointer-events-none invisible opacity-0"}`}>Отменить пару</button>
            </form>
          </div>

          <div className="grid grid-rows-3 gap-3">
            <Counter value={0} label="Принято WB" tone="success" onClick={() => setDetailsPanel("accepted")} />
            <Counter value={pairedLabels.length} label="Проверяется" tone="pending" onClick={() => setDetailsPanel("processing")} />
            <Counter value={scanError ? 1 : 0} label="Ошибки" tone="error" onClick={() => setDetailsPanel("errors")} />
          </div>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--border)]">
        <div className="min-w-[1080px]">
          <div className="flex items-center justify-between gap-3 bg-amber-500/10 px-5 py-4">
            <div className="flex items-center gap-3"><QrCode className="text-amber-500" size={25} /><div><div className="text-lg font-bold">Трусы</div><div className="text-sm text-[var(--text-muted)]">«Честный знак» обязателен</div></div></div>
            <div className="flex items-center gap-3"><button type="button" onClick={resetPrintSimulation} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm font-medium transition hover:bg-[var(--bg-card-hover)]">Сбросить симуляцию</button><span className="rounded-full bg-amber-500 px-3 py-1 text-sm font-semibold text-white">10 заказов</span></div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--bg)]/65 px-5 py-3">
            <div><span className="text-sm text-[var(--text-muted)]">Артикул WB</span> <strong>398657691</strong></div>
            <div className="text-sm text-[var(--text-muted)]">1 размер · 10 этикеток</div>
          </div>

          <div className="grid grid-cols-[110px_minmax(300px,1fr)_1px_160px_210px_250px] items-center gap-4 border-t border-[var(--border)] p-4 text-center">
            <div className="flex justify-center"><div className="flex h-[120px] w-[90px] items-center justify-center overflow-hidden rounded-lg bg-white p-1">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={getWbImageUrl(398657691, "small")} alt="Трусы женские хлопковые" className="h-full w-full object-contain" /></div></div>
            <div className="min-w-0 text-left"><div className="font-semibold leading-snug">Трусы женские хлопковые, комплект 8 шт.</div><div className="mt-2 text-sm text-[var(--text-muted)]">Артикул: <strong className="text-[var(--text)]">sl-8338-mc-9</strong> · Размер: <strong className="text-[var(--text)]">46–48</strong></div><div className="mt-2 text-sm text-[var(--text-muted)]">Напечатано <strong>{printState === "idle" ? 0 : 10 - printRemaining}/10</strong> · «Честный знак» <strong className="text-amber-500">0/10</strong></div></div>
            <div className="h-full w-px bg-[var(--border)]" />
            <button type="button" className="w-full rounded-lg p-2 text-center transition hover:bg-[var(--accent)]/10"><div className="text-lg font-semibold">10</div><div className="text-sm font-medium text-[var(--accent)]">Открыть список →</div></button>
            <div className="font-mono text-sm">2043775814661</div>
            <div className="flex w-[250px] items-center justify-end">
              {printState === "printed" ? batchComplete ? <div className="flex w-full flex-col items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 font-semibold text-emerald-500"><span>Пачка отсканирована</span><strong className="text-2xl">10/10</strong></div> : scanSessionActive ? <div className="flex w-full flex-col items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 font-semibold text-amber-500"><span>Маркировка</span><strong className="text-2xl">{pairedLabels.length}/10</strong></div> : <button type="button" onClick={() => { setScanSessionActive(true); setPairedLabels([]); setScanError(""); setLabelScanned(false); window.setTimeout(() => { document.getElementById("demo-pair-scanner")?.scrollIntoView({ behavior: "smooth", block: "start" }); document.querySelector<HTMLInputElement>('input[placeholder="Отсканируйте этикетку WB"]')?.focus({ preventScroll: true }); }, 30); }} className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-3 font-medium text-white transition hover:brightness-110"><QrCode size={20} />Маркировать 10</button> : <button type="button" onClick={() => { setPrintRemaining(10); setPrintState("printing"); setScanSessionActive(false); setPairedLabels([]); setScanError(""); setLabelScanned(false); }} disabled={printState === "printing"} className="group flex min-h-[88px] w-full flex-col justify-center gap-1 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-white transition hover:brightness-110 disabled:cursor-wait disabled:opacity-80"><span className="flex items-center justify-center gap-2 text-base font-medium">{printState === "printing" ? <Loader2 size={22} className="animate-spin" /> : <Printer size={22} />}<span>{printState === "printing" ? "Печатается" : "Печать"}</span></span><span className="text-4xl font-black leading-none tabular-nums">{printState === "printing" ? printRemaining : 10}</span></button>}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--bg)] p-3">
        <span className="text-sm">Напечатано <strong>{printState === "idle" ? 0 : 10 - printRemaining} из 10</strong> · Попарно отсканировано <strong>{pairedLabels.length} из 10</strong></span>
        <button type="button" disabled={!batchComplete} className="rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-white disabled:opacity-35">{batchComplete ? "Пачка готова" : `Осталось отсканировать: ${10 - pairedLabels.length}`}</button>
      </div>
    </section>

    {detailsPanel === "accepted" && <div className="fixed inset-0 z-[150] flex justify-end bg-black/65" role="presentation" onClick={() => setDetailsPanel(null)}>
      <aside className="h-full w-full max-w-[520px] overflow-y-auto border-l border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-2xl" role="dialog" aria-modal="true" aria-label="Принятые WB коды маркировки" onClick={(event) => event.stopPropagation()}>
        <div className="mb-5 flex items-start justify-between gap-3">
          <div><div className="text-xl font-bold">Принято WB</div><p className="mt-1 text-sm text-[var(--text-muted)]">Все показанные коды успешно прошли проверку Wildberries.</p></div>
          <button type="button" onClick={() => setDetailsPanel(null)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--border)] transition hover:bg-[var(--bg-card-hover)]" aria-label="Закрыть принятые коды"><X size={20} /></button>
        </div>
        <div className="mb-4 flex items-center justify-between rounded-xl bg-emerald-500/10 px-4 py-3 text-emerald-500"><span className="font-semibold">Успешно проверено</span><strong className="text-2xl tabular-nums">0</strong></div>
        <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-[var(--text-muted)]">В этой эмуляции ответы WB остаются на проверке, чтобы было видно отдельный счётчик спаренных товаров.</div>
      </aside>
    </div>}

    {detailsPanel === "processing" && <div className="fixed inset-0 z-[150] flex justify-end bg-black/65" role="presentation" onClick={() => setDetailsPanel(null)}>
      <aside className="h-full w-full max-w-[520px] overflow-y-auto border-l border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-2xl" role="dialog" aria-modal="true" aria-label="Коды Честного знака на проверке WB" onClick={(event) => event.stopPropagation()}>
        <div className="mb-5 flex items-start justify-between gap-3">
          <div><div className="text-xl font-bold">Проверяется WB</div><p className="mt-1 text-sm text-[var(--text-muted)]">Коды обрабатываются в фоне. Это окно можно закрыть и продолжить сканирование.</p></div>
          <button type="button" onClick={() => setDetailsPanel(null)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--border)] transition hover:bg-[var(--bg-card-hover)]" aria-label="Закрыть список"><X size={20} /></button>
        </div>
        <div className="mb-4 flex items-center justify-between rounded-xl bg-amber-500/10 px-4 py-3 text-amber-500"><span className="font-semibold">«Честный знак» на проверке</span><strong className="text-2xl tabular-nums">{pairedLabels.length}</strong></div>
        {pairedLabels.length === 0 ? <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-[var(--text-muted)]">Пока не отсканировано ни одной полной пары.</div> : <div className="space-y-2">
          {pairedLabels.map((label, index) => <div key={label} className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3">
            <div><div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Этикетка {index + 1}</div><div className="mt-1"><HighlightedLabel value={label} /></div></div>
            <span className="flex shrink-0 items-center gap-2 text-sm font-medium text-amber-500"><Loader2 size={17} className="animate-spin" />Проверяется</span>
          </div>)}
        </div>}
      </aside>
    </div>}

    {detailsPanel === "errors" && <div className="fixed inset-0 z-[150] flex justify-end bg-black/65" role="presentation" onClick={() => setDetailsPanel(null)}>
      <aside className="h-full w-full max-w-[560px] overflow-y-auto border-l border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-2xl" role="dialog" aria-modal="true" aria-label="Ошибки проверки маркировки" onClick={(event) => event.stopPropagation()}>
        <div className="mb-5 flex items-start justify-between gap-3">
          <div><div className="text-xl font-bold">Ошибки проверки</div><p className="mt-1 text-sm text-[var(--text-muted)]">Найдите указанный товар и пересканируйте «Честный знак».</p></div>
          <button type="button" onClick={() => setDetailsPanel(null)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--border)] transition hover:bg-[var(--bg-card-hover)]" aria-label="Закрыть ошибки"><X size={20} /></button>
        </div>

        <div className="mb-4 flex items-center justify-between rounded-xl bg-red-500/10 px-4 py-3 text-red-500"><span className="font-semibold">Требует исправления</span><strong className="text-2xl tabular-nums">{scanError ? 1 : 0}</strong></div>

        {!scanError ? <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-[var(--text-muted)]">Ошибок сканирования пока нет.</div> : <div className="overflow-hidden rounded-2xl border border-red-500/30 bg-red-500/5">
          <div className="flex items-center gap-3 border-b border-red-500/20 p-4">
            <div className="flex h-[92px] w-[70px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={getWbImageUrl(398657691, "small")} alt="Трусы женские хлопковые" className="h-full w-full object-contain" />
            </div>
            <div className="min-w-0"><div className="font-semibold">Трусы женские хлопковые, комплект 8 шт.</div><div className="mt-1 text-sm text-[var(--text-muted)]">Артикул sl-8338-mc-9 · размер 46–48</div><div className="mt-2 inline-flex rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-500">Неверная последовательность</div></div>
          </div>

          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <div className="rounded-xl bg-[var(--bg-card)] p-3 sm:col-span-2"><div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Номер этикетки</div><div className="mt-1"><HighlightedLabel value={currentBatchLabel || BATCH_LABELS[BATCH_LABELS.length - 1]} /></div></div>
            <div className="rounded-xl bg-[var(--bg-card)] p-3"><div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Этап</div><div className="mt-1 font-semibold">Попарное сканирование</div></div>
            <div className="rounded-xl bg-[var(--bg-card)] p-3"><div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Статус</div><div className="mt-1 font-semibold text-red-500">Нужно пересканировать</div></div>
          </div>

          <div className="border-t border-red-500/20 p-4"><div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Что произошло</div><p className="mt-2 leading-relaxed text-red-500">{scanError}</p></div>
        </div>}

        {scanError && <button type="button" onClick={() => { setDetailsPanel(null); setScanError(""); }} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3 font-semibold text-white"><ScanLine size={19} />Вернуться к сканированию</button>}
      </aside>
    </div>}
  </main>;
}
