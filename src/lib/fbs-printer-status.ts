export type FbsPrintAgent = {
  agent_id: string;
  name: string;
  printer_name: string;
  status: string;
  last_error: string;
  last_seen_at: string | null;
};

export type FbsPrinterProblem = {
  code: string;
  title: string;
  detail: string;
};

export type FbsPrinterIndicator = {
  tone: "ready" | "warning" | "error" | "unknown";
  label: string;
};

export function resolveFbsPrinter(agents: FbsPrintAgent[]) {
  const configured = agents[0] || null;
  const connected = agents.find((agent) => agent.status !== "offline") || configured;
  const ready = connected ? ["online", "printing"].includes(connected.status) : false;
  return { configured, connected, ready };
}

export function getFbsPrinterProblem(agent: FbsPrintAgent | null): FbsPrinterProblem {
  if (!agent) return { code: "PRN-001", title: "Принтер ещё не подключён", detail: "Обратитесь к администратору для первичной настройки." };
  const error = String(agent.last_error || "");
  const normalized = error.toLowerCase();
  if (agent.status === "offline") return { code: "PRN-002", title: "Нет связи с программой печати", detail: "Проверьте компьютер, Zebra и USB-кабель, затем запустите автоматическое восстановление." };
  if (agent.status === "repairing") return { code: "PRN-008", title: "Печать восстанавливается", detail: "Дождитесь завершения программы восстановления и нажмите «Проверить снова»." };
  if (/paperout|paper out|бумаг/.test(normalized)) return { code: "PRN-004", title: "В Zebra закончилась бумага", detail: "Установите рулон, закройте крышку и нажмите «Проверить снова»." };
  if (/offline|не доступ|not found|cannot access/.test(normalized)) return { code: "PRN-005", title: "Windows не видит Zebra", detail: "Проверьте питание и USB-кабель принтера." };
  if (/userintervention|attention|blocked|вниман/.test(normalized)) return { code: "PRN-006", title: "Zebra требует внимания", detail: "Проверьте бумагу, крышку и индикатор на принтере." };
  return { code: "PRN-007", title: "Печать остановлена", detail: error || "Выполните проверку и автоматическое восстановление." };
}

export function getFbsPrinterIndicator(agents: FbsPrintAgent[] | null): FbsPrinterIndicator {
  if (agents === null) return { tone: "unknown", label: "Проверяем принтер" };
  const { connected, ready } = resolveFbsPrinter(agents);
  if (ready) return { tone: "ready", label: "Принтер готов" };
  if (connected?.status === "repairing") return { tone: "warning", label: "Принтер восстанавливается" };
  if (!connected) return { tone: "unknown", label: "Принтер не настроен" };
  return { tone: "error", label: getFbsPrinterProblem(connected).title };
}
