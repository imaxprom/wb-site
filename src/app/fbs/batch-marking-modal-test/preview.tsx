"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Loader2, Printer, QrCode, ScanLine, X } from "lucide-react";
import { getWbImageUrl } from "@/lib/wb-image";

const LABELS = [
  "56676777811", "56676777936", "56676778042", "56676778157", "56676778263",
  "56676778378", "56676778484", "56676778599", "56676778705", "56676778810",
];

type PrintState = "idle" | "printing" | "printed";
type ScanPhase = "label" | "mark";
type WbState = "idle" | "checking" | "accepted";

function remainingText(count: number) {
  if (count === 1) return "Остался 1 товар";
  if (count >= 2 && count <= 4) return `Осталось ${count} товара`;
  return `Осталось ${count} товаров`;
}

function HighlightedLabel({ value }: { value: string }) {
  return <span className="inline-flex items-baseline whitespace-nowrap font-mono font-semibold tracking-wide"><span>{value.slice(0, -4)}</span><span className="ml-2 text-xl font-extrabold text-[var(--accent)]">{value.slice(-4)}</span></span>;
}

function playErrorTone() {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(190, context.currentTime);
    oscillator.frequency.setValueAtTime(155, context.currentTime + 0.22);
    gain.gain.setValueAtTime(0.14, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.48);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.48);
    oscillator.addEventListener("ended", () => void context.close(), { once: true });
  } catch {
    // Красное предупреждение остаётся, если браузер запретил звук.
  }
}

function ProductPhoto({ large = false }: { large?: boolean }) {
  return <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-1 ${large ? "h-[132px] w-[100px]" : "h-[108px] w-[80px]"}`}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={getWbImageUrl(398657691, "small")} alt="Трусы женские хлопковые" className="h-full w-full object-contain" /></div>;
}

export function BatchMarkingModalPreview() {
  const [printState, setPrintState] = useState<PrintState>("idle");
  const [printRemaining, setPrintRemaining] = useState(10);
  const [modalOpen, setModalOpen] = useState(false);
  const [paired, setPaired] = useState(0);
  const [phase, setPhase] = useState<ScanPhase>("label");
  const [scanError, setScanError] = useState("");
  const [wbState, setWbState] = useState<WbState>("idle");

  const remaining = Math.max(0, LABELS.length - paired);
  const currentLabel = LABELS[paired] || LABELS[LABELS.length - 1];
  const productVisible = phase === "mark" && paired < LABELS.length;
  const acceptedByWb = wbState === "accepted" ? LABELS.length : Math.max(0, paired - 2);

  useEffect(() => {
    const existed = document.documentElement.classList.contains("fbs-readable-ui");
    document.documentElement.classList.add("fbs-readable-ui");
    return () => { if (!existed) document.documentElement.classList.remove("fbs-readable-ui"); };
  }, []);

  useEffect(() => {
    if (printState !== "printing") return;
    if (printRemaining <= 0) {
      setPrintState("printed");
      setModalOpen(true);
      setPhase("label");
      return;
    }
    const timer = window.setTimeout(() => setPrintRemaining((value) => Math.max(0, value - 1)), 500);
    return () => window.clearTimeout(timer);
  }, [printRemaining, printState]);

  useEffect(() => {
    if (paired !== LABELS.length) return;
    setWbState("checking");
    const closeTimer = window.setTimeout(() => setModalOpen(false), 900);
    const acceptedTimer = window.setTimeout(() => setWbState("accepted"), 3_200);
    return () => {
      window.clearTimeout(closeTimer);
      window.clearTimeout(acceptedTimer);
    };
  }, [paired]);

  useEffect(() => {
    if (!modalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [modalOpen]);

  const reset = () => {
    setPrintState("idle");
    setPrintRemaining(10);
    setModalOpen(false);
    setPaired(0);
    setPhase("label");
    setScanError("");
    setWbState("idle");
  };

  const startPrint = () => {
    reset();
    setPrintState("printing");
  };

  const reportError = (message: string) => {
    setScanError(message);
    playErrorTone();
  };

  const scanCorrectLabel = () => {
    if (paired >= LABELS.length) return;
    if (phase === "mark") {
      reportError(`Сначала отсканируйте «Честный знак» для этикетки ${currentLabel}`);
      return;
    }
    setPhase("mark");
    setScanError("");
  };

  const scanCorrectMark = () => {
    if (paired >= LABELS.length) return;
    if (phase === "label") {
      reportError("Сначала отсканируйте этикетку WB на товаре");
      return;
    }
    setPaired((value) => value + 1);
    setPhase("label");
    setScanError("");
  };

  const simulateWrongScan = () => {
    reportError(phase === "mark"
      ? `Отсканирована следующая этикетка WB. Сначала нужен «Честный знак» для ${currentLabel}`
      : "Отсканирован код, которого нет среди оставшихся этикеток активной пачки");
  };

  const action = printState === "idle"
    ? <button type="button" onClick={startPrint} className="group flex min-h-[88px] w-full flex-col items-center justify-center gap-1 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-white transition hover:brightness-110"><span className="flex items-center gap-2 font-medium"><Printer size={22} />Печать</span><strong className="text-4xl leading-none">10</strong></button>
    : printState === "printing"
      ? <div className="flex min-h-[88px] w-full flex-col items-center justify-center gap-1 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-white"><span className="flex items-center gap-2 font-medium"><Loader2 size={22} className="animate-spin" />Печатается</span><strong className="text-4xl leading-none">{printRemaining}</strong></div>
      : paired < LABELS.length
        ? <button type="button" onClick={() => setModalOpen(true)} className="flex w-full flex-col items-center justify-center rounded-xl bg-amber-500 px-4 py-2.5 text-[21px] font-semibold leading-tight text-white transition hover:brightness-110"><span>{remaining === 1 ? "Остался" : "Осталось"}</span><span>{remaining} {remaining === 1 ? "товар" : remaining >= 2 && remaining <= 4 ? "товара" : "товаров"}</span></button>
        : wbState === "accepted"
          ? <div className="flex min-h-[88px] w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 font-semibold text-emerald-500"><CheckCircle2 size={22} />Готово</div>
          : <div className="flex min-h-[88px] w-full items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 font-semibold text-amber-500"><Loader2 size={22} className="animate-spin" />Проверяется WB</div>;

  return <main className="mx-auto max-w-[1500px] space-y-5 pb-12">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><div className="mb-2 inline-flex rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-500">Только localhost · принтер и WB не затрагиваются</div><h1 className="text-2xl font-bold">Полный сценарий маркировки</h1><p className="mt-1 text-sm text-[var(--text-muted)]">Печать → автоматическое окно → 10 пар сканирования → фоновая проверка WB.</p></div><div className="flex gap-2"><button type="button" onClick={reset} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium">Начать заново</button><Link href="/fbs/pair-scanning-variants-test" className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm">Сравнение вариантов</Link></div></header>

    <section className="grid gap-2 md:grid-cols-4">{["1. Новые заказы", "2. Сборка", "3. Маркировка", "4. Отгрузка"].map((title, index) => <div key={title} className={`rounded-xl border px-4 py-3 ${index === 1 ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--border)] bg-[var(--bg-card)]"}`}><div className="font-semibold">{title}</div><div className="text-sm text-[var(--text-muted)]">{index === 1 ? "активный этап" : "ожидает"}</div></div>)}</section>

    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4"><div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">2. Сборка товара</h2><div className="text-sm text-[var(--text-muted)]">Рабочая поставка: Домодедово — FBS — 10.08.2026</div></div><div className="rounded-full bg-amber-500/10 px-3 py-1 text-sm font-semibold text-amber-500">Трусы · 10 заказов</div></div>
      <div className="overflow-x-auto rounded-xl border border-[var(--border)]"><div className="min-w-[1050px]"><div className="grid grid-cols-[110px_minmax(300px,1fr)_1px_160px_210px_270px] items-center gap-4 bg-[var(--bg)] px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"><span>Фото</span><span>Товар</span><span /><span>Этикетки</span><span>ШК товара</span><span>Действие</span></div><div className="grid grid-cols-[110px_minmax(300px,1fr)_1px_160px_210px_270px] items-center gap-4 border-t border-[var(--border)] p-4 text-center"><div className="flex justify-center"><ProductPhoto /></div><div className="text-left"><div className="font-semibold">Трусы женские хлопковые, комплект 8 шт.</div><div className="mt-2 text-sm text-[var(--text-muted)]">Артикул: <strong className="text-[var(--text)]">sl-8338-mc-9</strong> · Размер: <strong className="text-[var(--text)]">46–48</strong></div><div className="mt-2 text-sm text-[var(--text-muted)]">Напечатано <strong>{printState === "idle" ? 0 : 10 - printRemaining}/10</strong> · <span className="font-semibold text-amber-500">Честный знак {acceptedByWb}/10</span></div></div><div className="h-full w-px bg-[var(--border)]" /><button type="button" className="w-full rounded-lg p-2 transition hover:bg-[var(--accent)]/10"><div className="text-xl font-semibold">10</div><div className="text-sm text-[var(--accent)]">Открыть список →</div></button><div className="font-mono text-sm">2043775814661</div><div>{action}</div></div></div></div>
    </section>

    {modalOpen && typeof document !== "undefined" && createPortal(<div className="fixed inset-0 z-[200] bg-black/70 p-3 sm:p-6" role="presentation"><section className="relative mx-auto h-full w-full max-w-[1280px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] shadow-2xl" role="dialog" aria-modal="true" aria-label="Маркировка 10 товаров">
      {scanError && <div className="absolute left-1/2 top-5 z-30 flex w-full max-w-[620px] -translate-x-1/2 items-start gap-3 rounded-xl border border-red-500/50 bg-[var(--bg-card)] p-4 text-red-500 shadow-2xl"><AlertTriangle className="mt-0.5 shrink-0" size={23} /><div className="min-w-0"><div className="font-bold">Ошибка сканирования</div><div className="mt-1 text-sm">{scanError}</div></div><button type="button" onClick={() => setScanError("")} className="ml-2 shrink-0 rounded p-1 hover:bg-red-500/10" aria-label="Закрыть ошибку"><X size={19} /></button></div>}
      <div className="absolute left-5 top-5 z-20 flex items-center gap-2 text-[var(--accent)]"><QrCode size={24} /><span className="text-xl font-semibold">Маркировка</span></div>
      {remaining > 0 && <button type="button" onClick={() => setModalOpen(false)} className="absolute right-5 top-5 z-40 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-sm font-medium">Свернуть</button>}

      <div className="flex h-full min-h-0 overflow-y-auto p-5"><div className="my-auto w-full py-14">
        <div className="flex justify-center text-center"><div className={`rounded-xl px-4 py-2 text-xl font-black ${remaining === 0 ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"}`}>{remaining === 0 ? "Готово 10/10" : remainingText(remaining)}</div></div>
        <div className="mt-4 flex w-full items-center gap-4"><div className="h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--bg)]"><div className={`h-full rounded-full transition-all duration-200 ${paired === 10 ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${paired * 10}%` }} /></div><div className="shrink-0 font-semibold tabular-nums text-amber-500">{paired} из 10</div></div>

        <div className={`mt-4 flex h-[300px] w-full flex-col overflow-hidden rounded-xl border p-4 ${productVisible ? "border-[var(--accent)]/50 bg-[var(--accent)]/5" : "border-[var(--border)] bg-[var(--bg)]"}`}>
          <div aria-hidden={!productVisible} className={`relative flex h-[174px] shrink-0 items-start gap-4 overflow-hidden rounded-xl bg-[var(--bg-card)] p-4 transition-opacity ${productVisible ? "opacity-100" : "pointer-events-none invisible opacity-0"}`}><ProductPhoto large /><div className="min-w-0 pr-[250px] pt-1"><div className="text-lg font-semibold">Трусы женские хлопковые, комплект 8 шт.</div><div className="mt-1 text-sm text-[var(--text-muted)]">Артикул sl-8338-mc-9 · размер 46–48</div><div className="mt-2"><HighlightedLabel value={currentLabel} /></div></div><div className="absolute right-4 top-4 inline-flex rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-500">Этикетка WB найдена</div></div>
          <div className="mt-3 flex gap-2"><input className="min-w-0 flex-1 rounded-lg border-2 border-[var(--accent)]/45 bg-[var(--bg-card)] px-4 py-3 font-mono text-lg outline-none" placeholder={productVisible ? "Отсканируйте «Честный знак»" : "Отсканируйте этикетку WB"} /><button type="button" onClick={productVisible ? scanCorrectMark : scanCorrectLabel} className="flex min-w-[150px] items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 font-medium text-white"><ScanLine size={20} />Сканировать</button><button type="button" onClick={() => { setPhase("label"); setScanError(""); }} aria-hidden={!productVisible} tabIndex={productVisible ? 0 : -1} className={`shrink-0 rounded-lg border border-[var(--border)] px-4 text-sm font-medium ${productVisible ? "visible" : "pointer-events-none invisible"}`}>Отменить пару</button></div>
        </div>

        <div className="mt-4 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3"><div className="mb-2 text-sm font-semibold text-sky-500">Учебное управление — в рабочей версии этих кнопок не будет</div><div className="grid gap-2 sm:grid-cols-3"><button type="button" onClick={scanCorrectLabel} disabled={phase !== "label" || paired === 10} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm font-medium disabled:opacity-35">Правильная этикетка WB</button><button type="button" onClick={scanCorrectMark} disabled={phase !== "mark" || paired === 10} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm font-medium disabled:opacity-35">Правильный «Честный знак»</button><button type="button" onClick={simulateWrongScan} disabled={paired === 10} className="rounded-lg border border-red-500/35 bg-red-500/5 px-3 py-2 text-sm font-medium text-red-500 disabled:opacity-35">Неправильное сканирование</button></div></div>
      </div></div>
    </section></div>, document.body)}
  </main>;
}
