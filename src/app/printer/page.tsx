"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Download,
  Loader2,
  Printer,
  RefreshCw,
  Wrench,
} from "lucide-react";
import {
  getFbsPrinterProblem,
  resolveFbsPrinter,
  type FbsPrintAgent,
} from "@/lib/fbs-printer-status";

type PrintJob = {
  job_id: string;
  status: "queued" | "printing" | "paused" | "completed" | "cancelled" | "error";
  last_error: string;
};

type PrinterSnapshot = {
  printAgents: FbsPrintAgent[];
  printJobs: PrintJob[];
};

const EMPTY: PrinterSnapshot = { printAgents: [], printJobs: [] };

function formatLastSeen(value: string | null | undefined) {
  if (!value) return "связи ещё не было";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export default function PrinterPage() {
  const [data, setData] = useState<PrinterSnapshot>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [printAgentToken, setPrintAgentToken] = useState("");
  const [pairingAgentId, setPairingAgentId] = useState("");
  const [repairStarted, setRepairStarted] = useState(false);
  const [testJobId, setTestJobId] = useState("");
  const [testOutcome, setTestOutcome] = useState<"" | "waiting" | "confirm">("");

  useEffect(() => {
    const readableModeWasEnabled = document.documentElement.classList.contains("fbs-readable-ui");
    document.documentElement.classList.add("fbs-readable-ui");
    return () => {
      if (!readableModeWasEnabled) document.documentElement.classList.remove("fbs-readable-ui");
    };
  }, []);

  const load = useCallback(async (quiet = false) => {
    try {
      const response = await fetch("/api/fbs?printer=1", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      const snapshot = {
        printAgents: Array.isArray(payload.printAgents) ? payload.printAgents : [],
        printJobs: Array.isArray(payload.printJobs) ? payload.printJobs : [],
      } as PrinterSnapshot;
      setData(snapshot);
      if (!quiet) setError("");
      window.dispatchEvent(new CustomEvent("fbs-printer-status-changed", { detail: snapshot.printAgents }));
      return snapshot;
    } catch (cause) {
      if (!quiet) setError(cause instanceof Error ? cause.message : "Не удалось проверить принтер");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    Promise.all([
      fetch("/api/fbs-portal/organizations", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).catch(() => null),
      fetch("/api/auth/me", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).catch(() => null),
    ]).then(([portal, mphub]) => {
      setIsAdmin(Boolean(portal?.user?.isAdmin || ["owner", "admin"].includes(String(mphub?.organizationRole || ""))));
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const { configured, connected, ready } = resolveFbsPrinter(data.printAgents);
  const problem = getFbsPrinterProblem(connected);
  const testJob = testJobId ? data.printJobs.find((job) => job.job_id === testJobId) || null : null;
  const pairingAgent = pairingAgentId ? data.printAgents.find((agent) => agent.agent_id === pairingAgentId) || null : null;
  const pairingReady = Boolean(pairingAgent && ["online", "printing"].includes(pairingAgent.status));
  const testStatus = testJob?.status || "";
  const activeJobs = useMemo(() => data.printJobs.filter((job) => ["queued", "printing", "paused"].includes(job.status)), [data.printJobs]);
  const pausedJobs = activeJobs.filter((job) => job.status === "paused").length;

  useEffect(() => {
    if (!repairStarted && testOutcome !== "waiting") return;
    const timer = window.setInterval(() => void load(true), 3_000);
    return () => window.clearInterval(timer);
  }, [load, repairStarted, testOutcome]);

  useEffect(() => {
    if (!repairStarted || !ready) return;
    setRepairStarted(false);
    setNotice("Принтер снова подключён. Напечатайте тестовую этикетку.");
  }, [ready, repairStarted]);

  useEffect(() => {
    if (!testJobId || !testStatus) return;
    if (testStatus === "completed") {
      setTestOutcome("confirm");
      return;
    }
    if (["paused", "error", "cancelled"].includes(testStatus)) {
      setTestOutcome("");
      setError(testJob?.last_error || "Тестовая этикетка не напечаталась. Запустите восстановление принтера.");
    }
  }, [testJob?.last_error, testJobId, testStatus]);

  async function action(name: string, body: Record<string, unknown>) {
    setBusy(name);
    setError("");
    try {
      const response = await fetch("/api/fbs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, compact: true }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      await load(true);
      return payload.result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Операция не выполнена");
      throw cause;
    } finally {
      setBusy("");
    }
  }

  async function checkAgain() {
    setBusy("check");
    setError("");
    try {
      const snapshot = await load(true);
      const state = resolveFbsPrinter(snapshot?.printAgents || []);
      if (state.ready) {
        setRepairStarted(false);
        setNotice("Принтер подключён и готов к печати.");
      } else {
        const currentProblem = getFbsPrinterProblem(state.connected);
        setError(`${currentProblem.title}. Код ${currentProblem.code}.`);
      }
    } finally {
      setBusy("");
    }
  }

  function startRepair() {
    if (!configured) {
      setError("Принтер ещё не установлен. Обратитесь к администратору. Код PRN-001.");
      return;
    }
    setRepairStarted(true);
    setNotice("В окне Windows нажмите «Открыть». Дождитесь завершения восстановления.");
    window.location.assign(`mphub-print://repair?code=${problem.code}`);
  }

  async function printTestLabel() {
    const result = await action("test", { action: "test_print" }) as PrintJob;
    setTestJobId(result.job_id);
    setTestOutcome("waiting");
    setNotice("Тестовая этикетка с прожигом 30 передана на Zebra.");
  }

  async function sendSupportReport() {
    const result = await action("support", { action: "printer_support", page: "printer" }) as { code?: string };
    setNotice(`Отчёт сохранён. Сообщите администратору код ${result?.code || problem.code}.`);
  }

  async function pairPrintAgent() {
    const result = await action("pair", { action: "create_print_agent", name: "Новый компьютер FBS" }) as { agentId: string; token: string };
    setPairingAgentId(result.agentId);
    setPrintAgentToken(result.token);
    setNotice("Ключ нового компьютера создан. Скопируйте команду установки — повторно ключ не показывается.");
  }

  const installCommand = printAgentToken
    ? `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\\install-fbs-print-agent-windows.ps1" -ServerUrl "https://hub.imaxprom.site" -Token "${printAgentToken}"`
    : "";

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="animate-spin text-[var(--accent)]" /></div>;

  return <main className="fbs-portal-content space-y-5">
    <header>
      <h1 className="text-2xl font-bold">Принтер</h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">Состояние Zebra, проверка и восстановление печати</p>
    </header>

    {(error || notice) && <div className="pointer-events-none fixed inset-x-4 top-4 z-[100] flex flex-col items-end gap-2 sm:left-auto sm:w-[440px]" aria-live="polite">
      {error && <div role="alert" className="pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-red-500/40 bg-[var(--bg-card)] p-4 text-red-500 shadow-2xl"><AlertTriangle className="mt-0.5 shrink-0" size={20} /><span className="min-w-0 flex-1">{error}</span><button type="button" onClick={() => setError("")} className="rounded px-2 text-xl leading-none" aria-label="Закрыть">×</button></div>}
      {notice && <div role="status" className="pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-emerald-500/40 bg-[var(--bg-card)] p-4 text-emerald-500 shadow-2xl"><CheckCircle2 className="mt-0.5 shrink-0" size={20} /><span className="min-w-0 flex-1">{notice}</span><button type="button" onClick={() => setNotice("")} className="rounded px-2 text-xl leading-none" aria-label="Закрыть">×</button></div>}
    </div>}

    {ready ? <section className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500 text-white"><Printer size={29} /></span>
          <div><div className="text-xl font-bold text-emerald-500">Принтер готов</div><div className="mt-1 text-[var(--text-muted)]">{connected?.printer_name || connected?.name}</div><div className="mt-1 text-sm text-[var(--text-muted)]">Последняя связь: {formatLastSeen(connected?.last_seen_at)}</div></div>
        </div>
        <button type="button" onClick={() => void printTestLabel()} disabled={Boolean(busy) || testOutcome === "waiting"} className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-[var(--bg-card)] px-5 py-3 font-semibold text-emerald-500 disabled:opacity-45">{testOutcome === "waiting" ? <Loader2 size={19} className="animate-spin" /> : <Printer size={19} />}{testOutcome === "waiting" ? "Печатаем тест…" : "Тестовая этикетка · прожиг 30"}</button>
      </div>
      {testOutcome === "confirm" && <div className="mt-5 rounded-xl border border-emerald-500/30 bg-[var(--bg-card)] p-4"><div className="font-semibold">Тестовая этикетка «TEST FBS» напечаталась?</div><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => { setTestOutcome(""); setTestJobId(""); setNotice("Проверка завершена — можно продолжать работу."); }} className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-white">Да, напечаталась</button><button type="button" onClick={() => { setTestOutcome(""); setError("Тестовая этикетка не вышла. Запустите восстановление. Код PRN-009."); }} className="rounded-lg border border-red-500/40 px-4 py-2 font-medium text-red-500">Нет, не напечаталась</button></div></div>}
    </section> : <section className={`rounded-xl border-2 p-5 ${connected?.status === "repairing" ? "border-amber-500/40 bg-amber-500/5" : "border-red-500/40 bg-red-500/5"}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0"><div className={`flex items-center gap-2 text-xl font-bold ${connected?.status === "repairing" ? "text-amber-500" : "text-red-500"}`}><AlertTriangle size={23} />{problem.title}</div><p className="mt-1 text-base text-[var(--text-muted)]">{problem.detail}</p><div className="mt-2 font-mono text-sm font-semibold text-red-500">Код: {problem.code}</div></div>
        {connected?.printer_name && <div className="rounded-lg bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-muted)]">{connected.printer_name}</div>}
      </div>
      <ol className="mt-5 grid gap-3 text-base md:grid-cols-2">
        <li className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3"><strong>1.</strong> Убедитесь, что Zebra включена и горит зелёный индикатор.</li>
        <li className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3"><strong>2.</strong> Проверьте бумагу и плотно закройте крышку.</li>
        <li className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3"><strong>3.</strong> Проверьте USB-кабель между Zebra и компьютером.</li>
        <li className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3"><strong>4.</strong> Нажмите «Проверить снова».</li>
      </ol>
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={() => void checkAgain()} disabled={Boolean(busy)} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-5 py-3 font-semibold text-white disabled:opacity-45">{busy === "check" ? <Loader2 size={19} className="animate-spin" /> : <RefreshCw size={19} />}Проверить снова</button>
        {configured && <button type="button" onClick={startRepair} disabled={repairStarted} className="flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-3 font-semibold text-white disabled:opacity-45">{repairStarted ? <Loader2 size={19} className="animate-spin" /> : <Wrench size={19} />}{repairStarted ? "Восстанавливаем…" : "Восстановить печать автоматически"}</button>}
        <button type="button" onClick={() => void sendSupportReport()} disabled={Boolean(busy)} className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-5 py-3 font-medium"><CircleHelp size={19} />Нужна помощь</button>
      </div>
      {repairStarted && <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-600"><strong>Сейчас:</strong> в окне Windows нажмите «Открыть», дождитесь зелёного сообщения и вернитесь сюда. Если окно не появилось, запустите ярлык <strong>FBS Printer Recovery</strong> на рабочем столе.</div>}
    </section>}

    <section className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4"><div className="text-sm text-[var(--text-muted)]">Активная очередь</div><div className="mt-1 text-2xl font-bold">{activeJobs.length}</div></div>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4"><div className="text-sm text-[var(--text-muted)]">Требуют проверки</div><div className={`mt-1 text-2xl font-bold ${pausedJobs ? "text-amber-500" : ""}`}>{pausedJobs}</div></div>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4"><div className="text-sm text-[var(--text-muted)]">Рабочее место</div><div className="mt-1 truncate font-semibold">{configured?.name || "не настроено"}</div></div>
    </section>

    {isAdmin && <section className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-5">
      <div className="mb-4"><div className="text-lg font-semibold">{configured ? "Подключить новый компьютер" : "Первичная настройка принтера"}</div><p className="mt-1 text-sm text-[var(--text-muted)]">{configured ? "Используйте этот блок при замене моноблока или переносе Zebra на другое рабочее место. Старый зелёный статус не означает, что программа установлена на новом Windows." : "Этот блок предназначен только для администратора."}</p></div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl bg-[var(--bg-card)] p-4"><div className="font-semibold">1. Подготовьте Zebra</div><p className="mt-1 text-sm text-[var(--text-muted)]">Включите Zebra ZT220 и проверьте USB-подключение к Windows.</p></div>
        <div className="rounded-xl bg-[var(--bg-card)] p-4"><div className="font-semibold">2. Скачайте установщик</div><a href="/install-fbs-print-agent-windows.ps1" download className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 font-medium"><Download size={18} />Скачать установщик</a></div>
        <div className="rounded-xl bg-[var(--bg-card)] p-4"><div className="font-semibold">3. Создайте ключ именно для этого компьютера</div><button type="button" onClick={() => void pairPrintAgent()} disabled={Boolean(busy)} className="mt-3 rounded-lg bg-[var(--accent)] px-4 py-2 font-semibold text-white disabled:opacity-45">{busy === "pair" ? "Создаём…" : printAgentToken ? "Создать другой ключ" : configured ? "Подключить новый компьютер" : "Создать ключ подключения"}</button></div>
        <div className="rounded-xl bg-[var(--bg-card)] p-4"><div className="font-semibold">4. Запустите установку</div><p className="mt-1 text-sm text-[var(--text-muted)]">Откройте «Загрузки», в адресной строке напишите <code className="font-mono text-[var(--text)]">powershell</code>, нажмите Enter и вставьте команду.</p></div>
      </div>
      {printAgentToken && <div className="mt-4 rounded-lg border border-amber-500/30 bg-[var(--bg)] p-3"><div className="flex flex-col gap-2 sm:flex-row"><code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-black/20 px-3 py-2 text-xs leading-relaxed">{installCommand}</code><button type="button" onClick={() => void navigator.clipboard.writeText(installCommand).then(() => setNotice("Команда установки скопирована.")).catch(() => setError("Не удалось скопировать команду — выделите её вручную"))} className="shrink-0 rounded-lg bg-amber-500 px-4 py-2 font-semibold text-white">Скопировать команду</button></div><div className={`mt-3 rounded-lg border px-3 py-2 text-sm font-medium ${pairingReady ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500" : "border-amber-500/30 bg-amber-500/10 text-amber-600"}`}>{pairingReady ? `✓ Новый компьютер подключён: ${pairingAgent?.printer_name || "Zebra"}` : "Ожидаем новый компьютер. Выполните команду в PowerShell — статус обновится автоматически."}</div><p className="mt-2 text-xs text-[var(--text-muted)]">Для второго юрлица переключитесь на него и повторите шаги 2–4. Первое подключение сохранится.</p></div>}
    </section>}

    {isAdmin && configured && <details className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4"><summary className="cursor-pointer font-medium">Обслуживание уже подключённого компьютера — только для администратора</summary><div className="mt-4 flex flex-wrap items-center gap-3"><a href="/setup-fbs-printer-recovery.cmd" download className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-2 font-medium"><Download size={18} />Скачать одноразовое обновление</a><span className="text-sm text-[var(--text-muted)]">Этот файл работает только там, где print-agent уже установлен. Для нового моноблока используйте блок «Подключить новый компьютер» выше.</span></div></details>}
  </main>;
}
