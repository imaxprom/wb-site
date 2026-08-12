"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Printer, QrCode, RotateCcw, ScanLine, ShieldCheck, Truck, Trash2 } from "lucide-react";
import { getWbImageUrl } from "@/lib/wb-image";

type MarkingState = "accepted" | "pending" | "error" | "missing";
type DemoOrder = {
  id: number;
  label: string;
  article: string;
  size: string;
  barcode: string;
  nmId: number;
  state: MarkingState;
  error?: string;
};

const INITIAL_ORDERS: DemoOrder[] = [
  { id: 1, label: "56676777811", article: "sl-8338-mc-9", size: "42–44", barcode: "2043775814616", nmId: 398657691, state: "accepted" },
  { id: 2, label: "56676777936", article: "sl-8338-mc-9", size: "44–46", barcode: "2043775814623", nmId: 398657691, state: "accepted" },
  { id: 3, label: "56676778042", article: "sl-8338-mc-9", size: "46–48", barcode: "2043775814630", nmId: 398657691, state: "pending" },
  { id: 4, label: "56676778157", article: "sl-8338-mc-9", size: "48–50", barcode: "2043775814647", nmId: 398657691, state: "error", error: "WB не нашёл код в системе «Честный знак»" },
  { id: 5, label: "56676778263", article: "sl-8338-mc-9", size: "50–52", barcode: "2043775814654", nmId: 398657691, state: "missing" },
];

function LabelNumber({ value }: { value: string }) {
  return <span className="inline-flex items-baseline whitespace-nowrap font-mono font-semibold tracking-wide"><span>{value.slice(0, -4)}</span><span className="ml-2 text-xl font-extrabold text-[var(--accent)]">{value.slice(-4)}</span></span>;
}

function stateBadge(state: MarkingState) {
  if (state === "accepted") return <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-500">✓ Принят WB</span>;
  if (state === "pending") return <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-500"><Loader2 size={14} className="animate-spin" />Проверяется WB</span>;
  if (state === "error") return <span className="rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-500">✕ WB отклонил</span>;
  return <span className="rounded-full bg-slate-500/10 px-2.5 py-1 text-xs font-medium text-slate-400">Не отсканирован</span>;
}

export function MarkingStagePreview() {
  const [orders, setOrders] = useState(INITIAL_ORDERS);
  const [selectedId, setSelectedId] = useState(4);
  const [scanValue, setScanValue] = useState("");
  const [notice, setNotice] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [activeStage, setActiveStage] = useState<3 | 4>(3);
  const [preflightChecked, setPreflightChecked] = useState(false);
  const [delivered, setDelivered] = useState(false);
  const [qrPrinted, setQrPrinted] = useState(false);

  useEffect(() => {
    const existed = document.documentElement.classList.contains("fbs-readable-ui");
    document.documentElement.classList.add("fbs-readable-ui");
    return () => { if (!existed) document.documentElement.classList.remove("fbs-readable-ui"); };
  }, []);

  const selected = orders.find((order) => order.id === selectedId) || orders[0];
  const accepted = orders.filter((order) => order.state === "accepted").length;
  const pending = orders.filter((order) => order.state === "pending").length;
  const errors = orders.filter((order) => order.state === "error").length;
  const missing = orders.filter((order) => order.state === "missing").length;
  const allAccepted = accepted === orders.length;
  const statusText = useMemo(() => {
    if (allAccepted) return "Все коды приняты WB. Можно переходить к отгрузке.";
    if (errors || missing) return `Нужно исправить: ${errors + missing}`;
    return "Дождитесь завершения проверки WB.";
  }, [allAccepted, errors, missing]);

  const reset = () => {
    setOrders(INITIAL_ORDERS);
    setSelectedId(4);
    setScanValue("");
    setNotice("");
    setDeleteConfirm(false);
    setActiveStage(3);
    setPreflightChecked(false);
    setDelivered(false);
    setQrPrinted(false);
  };

  const submitMark = (event: React.FormEvent) => {
    event.preventDefault();
    if (!scanValue.trim() || !selected) return;
    const id = selected.id;
    setOrders((current) => current.map((order) => order.id === id ? { ...order, state: "pending", error: undefined } : order));
    setScanValue("");
    setNotice(`Этикетка ${selected.label}: код отправлен WB и проверяется в фоне.`);
    window.setTimeout(() => {
      setOrders((current) => current.map((order) => order.id === id ? { ...order, state: "accepted" } : order));
      setNotice(`Этикетка ${selected.label}: «Честный знак» принят WB.`);
    }, 1800);
  };

  const removeCode = () => {
    if (!selected) return;
    setOrders((current) => current.map((order) => order.id === selected.id ? { ...order, state: "missing", error: undefined } : order));
    setDeleteConfirm(false);
    setNotice(`Код для этикетки ${selected.label} удалён в учебном режиме.`);
  };

  return <main className="mx-auto max-w-[1500px] space-y-5 pb-12">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><div className="mb-2 inline-flex rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-500">Только localhost · данные WB не изменяются</div><h1 className="text-2xl font-bold">Тест третьего этапа</h1><p className="mt-1 text-sm text-[var(--text-muted)]">Контроль уже отсканированных кодов и исправление только проблемных этикеток.</p></div><button type="button" onClick={reset} className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium transition hover:bg-[var(--bg-card-hover)]"><RotateCcw size={17} />Сбросить пример</button></header>

    <section className="grid gap-2 md:grid-cols-4">{["1. Новые заказы", "2. Сборка", "3. Маркировка", "4. Отгрузка"].map((title, index) => {
      const stage = index + 1;
      const interactive = stage === 3 || stage === 4;
      const active = activeStage === stage;
      return <button type="button" key={title} disabled={!interactive} onClick={() => { if (stage === 3 || stage === 4) { setActiveStage(stage); setNotice(""); } }} className={`rounded-xl border px-4 py-3 text-left transition ${active ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--border)] bg-[var(--bg-card)]"} ${interactive ? "hover:border-[var(--accent)]" : "cursor-default"}`}><div className="font-semibold">{title}</div><div className="text-sm text-[var(--text-muted)]">{index < 2 ? "готово" : stage === 3 ? `${accepted}/${orders.length}` : delivered ? "передано" : allAccepted ? "готово к работе" : "есть ограничения"}</div></button>;
    })}</section>

    {notice && <div className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-4 py-3 text-sm text-[var(--accent)]">{notice}</div>}

    {activeStage === 3 && <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">3. Контроль маркировки</h2><p className="mt-1 text-sm text-[var(--text-muted)]">Коды со сборки уже здесь. Работник вмешивается только при ошибке или пропущенном товаре.</p></div><div className={`rounded-full px-3 py-1.5 text-sm font-semibold ${allAccepted ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"}`}>{statusText}</div></div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        <div className="rounded-xl bg-emerald-500/10 p-3"><div className="text-2xl font-bold text-emerald-500">{accepted}</div><div className="text-sm">Принято WB</div></div>
        <div className="rounded-xl bg-amber-500/10 p-3"><div className="text-2xl font-bold text-amber-500">{pending}</div><div className="text-sm">Проверяется</div></div>
        <div className="rounded-xl bg-red-500/10 p-3"><div className="text-2xl font-bold text-red-500">{errors}</div><div className="text-sm">Ошибки</div></div>
        <div className="rounded-xl bg-slate-500/10 p-3"><div className="text-2xl font-bold text-slate-400">{missing}</div><div className="text-sm">Не отсканировано</div></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(360px,0.85fr)_minmax(480px,1.15fr)]">
        <div className="max-h-[570px] overflow-auto rounded-xl border border-[var(--border)]">{orders.map((order) => <button type="button" key={order.id} onClick={() => { setSelectedId(order.id); setScanValue(""); setDeleteConfirm(false); }} className={`flex w-full items-center gap-3 border-b border-[var(--border)] p-3 text-left transition last:border-0 ${selectedId === order.id ? "bg-[var(--accent)]/10" : "hover:bg-[var(--bg-card-hover)]"}`}><div className="flex h-[86px] w-[66px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={getWbImageUrl(order.nmId, "small")} alt="Трусы женские" className="h-full w-full object-contain" /></div><div className="min-w-0 flex-1"><div className="font-semibold">Трусы женские · {order.size}</div><div className="mt-1 text-sm text-[var(--text-muted)]">{order.article} · ШК {order.barcode}</div><div className="mt-1"><LabelNumber value={order.label} /></div><div className="mt-2">{stateBadge(order.state)}</div></div></button>)}</div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-sm text-[var(--text-muted)]">Выбранная этикетка</div><div className="mt-1"><LabelNumber value={selected.label} /></div><div className="mt-2 font-semibold">Трусы женские · размер {selected.size}</div><div className="mt-1 text-sm text-[var(--text-muted)]">Артикул {selected.article} · WB {selected.nmId}</div></div>{stateBadge(selected.state)}</div>

          {selected.state === "error" && <div className="mt-5 flex items-start gap-3 rounded-xl border border-red-500/35 bg-red-500/10 p-4 text-red-500"><AlertTriangle className="mt-0.5 shrink-0" size={21} /><div><div className="font-semibold">WB не принял код</div><div className="mt-1 text-sm">{selected.error}</div></div></div>}
          {selected.state === "pending" && <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-500"><div className="flex items-center gap-3"><Loader2 className="animate-spin" size={21} /><div><div className="font-semibold">Проверяется WB</div><div className="text-sm">Сотруднику ничего делать не нужно.</div></div></div><button type="button" onClick={() => { setOrders((current) => current.map((order) => order.id === selected.id ? { ...order, state: "accepted" } : order)); setNotice(`Этикетка ${selected.label}: учебный ответ WB получен.`); }} className="mt-3 rounded-lg border border-amber-500/40 px-3 py-2 text-sm font-medium">Тест: получить ответ WB</button></div>}
          {selected.state === "accepted" && <div className="mt-5 flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-500"><CheckCircle2 size={22} /><div><div className="font-semibold">«Честный знак» принят WB</div><div className="text-sm">Эта позиция полностью готова.</div></div></div>}

          {(selected.state === "error" || selected.state === "missing") && <form onSubmit={submitMark} className="mt-5"><label className="mb-2 block text-sm font-medium">Отсканируйте новый «Честный знак»</label><div className="flex gap-2"><input value={scanValue} onChange={(event) => setScanValue(event.target.value)} className="min-w-0 flex-1 rounded-lg border-2 border-[var(--accent)]/45 bg-[var(--bg-card)] px-4 py-3 font-mono outline-none focus:border-[var(--accent)]" placeholder="Фокус для сканера" autoComplete="off" /><button disabled={!scanValue.trim()} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 font-medium text-white disabled:opacity-40"><ScanLine size={19} />Отправить WB</button></div></form>}

          {selected.state === "accepted" && <div className="mt-5 flex justify-end"><button type="button" onClick={() => setDeleteConfirm(true)} className="flex items-center gap-2 rounded-lg border border-amber-500/40 px-4 py-2.5 text-sm font-medium text-amber-500"><Trash2 size={17} />Удалить ошибочный код</button></div>}

          {deleteConfirm && <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4"><div className="font-semibold text-amber-500">Удалить код у этой этикетки?</div><div className="mt-3 flex gap-2"><button type="button" onClick={() => setDeleteConfirm(false)} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm">Отмена</button><button type="button" onClick={removeCode} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white">Да, удалить</button></div></div>}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-[var(--bg)] p-3"><span className="text-sm">Принято WB: <strong>{accepted} из {orders.length}</strong></span><button type="button" onClick={() => { setActiveStage(4); setNotice(""); }} disabled={!allAccepted} className="rounded-lg bg-[var(--accent)] px-5 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-35">Маркировка завершена — к отгрузке</button></div>
    </section>}

    {activeStage === 4 && <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <div className="mb-4"><h2 className="text-lg font-semibold">4. Контроль и отгрузка</h2><p className="mt-1 text-sm text-[var(--text-muted)]">Перед передачей в доставку система повторно проверяет сборку, печать этикеток и обязательную маркировку.</p></div>

      {!allAccepted && <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-500/35 bg-red-500/10 p-4 text-red-500"><AlertTriangle className="mt-0.5 shrink-0" size={22} /><div><div className="font-semibold">Поставка пока не готова к отгрузке</div><div className="mt-1 text-sm">Вернитесь в «Маркировку» и дождитесь принятия всех кодов WB. Непромаркированный товар передать нельзя.</div><button type="button" onClick={() => setActiveStage(3)} className="mt-3 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white">Вернуться к маркировке</button></div></div>}

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4"><CheckCircle2 className="text-emerald-500" size={25} /><div className="mt-3 font-semibold">Сборка завершена</div><div className="mt-1 text-sm text-[var(--text-muted)]">5 из 5 товаров</div></div>
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4"><CheckCircle2 className="text-emerald-500" size={25} /><div className="mt-3 font-semibold">Этикетки напечатаны</div><div className="mt-1 text-sm text-[var(--text-muted)]">5 из 5 этикеток</div></div>
        <div className={`rounded-xl border p-4 ${allAccepted ? "border-emerald-500/30 bg-emerald-500/10" : "border-red-500/30 bg-red-500/10"}`}>{allAccepted ? <CheckCircle2 className="text-emerald-500" size={25} /> : <AlertTriangle className="text-red-500" size={25} />}<div className="mt-3 font-semibold">«Честный знак»</div><div className="mt-1 text-sm text-[var(--text-muted)]">Принято WB: {accepted} из {orders.length}</div></div>
      </div>

      <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2 font-semibold"><ShieldCheck size={21} />Финальная проверка</div><div className="mt-1 text-sm text-[var(--text-muted)]">Обновляет статусы и проверяет блокирующие ошибки непосредственно перед передачей.</div></div><button type="button" onClick={() => { setPreflightChecked(true); setNotice(allAccepted ? "Контроль пройден: поставка готова к передаче в доставку." : `Контроль не пройден: WB принял ${accepted} из ${orders.length} кодов.`); }} className="rounded-lg border border-[var(--accent)] px-4 py-2.5 font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/10">Проверить перед отгрузкой</button></div>
        {preflightChecked && <div className={`mt-3 rounded-lg px-3 py-2 text-sm font-medium ${allAccepted ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"}`}>{allAccepted ? "Все проверки пройдены" : "Есть блокирующие ошибки"}</div>}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4"><div className="flex items-center gap-2 font-semibold"><Truck size={21} />Передача в доставку</div><p className="mt-2 text-sm text-[var(--text-muted)]">Необратимо переводит поставку в статус доставки после успешной контрольной проверки.</p><button type="button" onClick={() => { setDelivered(true); setNotice("Учебная поставка передана в доставку."); }} disabled={!allAccepted || !preflightChecked || delivered} className="mt-4 w-full rounded-lg bg-[var(--accent)] px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-35">{delivered ? "✓ Передано в доставку" : "Передать в доставку"}</button></div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4"><div className="flex items-center gap-2 font-semibold"><QrCode size={21} />QR-код поставки</div><p className="mt-2 text-sm text-[var(--text-muted)]">После передачи QR-код автоматически отправляется на подключённый принтер Zebra.</p><button type="button" onClick={() => { setQrPrinted(true); setNotice("Учебный QR-код отправлен на печать. Реальный принтер не затронут."); }} disabled={!delivered || qrPrinted} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--accent)] px-4 py-3 font-semibold text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-35"><Printer size={19} />{qrPrinted ? "✓ QR-код напечатан" : "Распечатать QR-код"}</button></div>
      </div>

      {qrPrinted && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4"><div><div className="font-semibold text-emerald-500">Работа с поставкой завершена</div><div className="mt-1 text-sm text-[var(--text-muted)]">Можно начать новый рабочий круг или выбрать другую поставку.</div></div><button type="button" onClick={reset} className="rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-white">Начать новый круг</button></div>}
    </section>}
  </main>;
}
