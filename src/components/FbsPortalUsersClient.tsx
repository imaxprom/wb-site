"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Copy, KeyRound, Loader2, Plus, Save, ShieldCheck, UserRound, UserX } from "lucide-react";

type Organization = { id: number; displayName: string };
type Permission = { organizationId: number; canAssembly: boolean; canStock: boolean };
type PortalUser = {
  id: number;
  email: string;
  name: string;
  status: "active" | "disabled";
  is_admin: boolean;
  last_login_at: string | null;
  created_at: string;
  permissions: Permission[];
};
type Payload = { currentUserId: number; organizations: Organization[]; users: PortalUser[] };

function emptyPermissions(organizations: Organization[]): Permission[] {
  return organizations.map((organization) => ({ organizationId: organization.id, canAssembly: true, canStock: true }));
}

function PermissionGrid({ organizations, value, onChange, disabled = false }: { organizations: Organization[]; value: Permission[]; onChange: (next: Permission[]) => void; disabled?: boolean }) {
  function permissionFor(organizationId: number) {
    return value.find((permission) => permission.organizationId === organizationId) || { organizationId, canAssembly: false, canStock: false };
  }
  function toggle(organizationId: number, field: "canAssembly" | "canStock", checked: boolean) {
    const current = permissionFor(organizationId);
    const next = { ...current, [field]: checked };
    onChange([...value.filter((permission) => permission.organizationId !== organizationId), next]);
  }
  return <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
    <div className="grid min-w-[620px] grid-cols-[minmax(220px,1fr)_150px_210px] bg-[var(--bg)] px-4 py-2.5 text-sm font-semibold text-[var(--text-muted)]"><span>Юрлицо</span><span className="text-center">FBS-сборка</span><span className="text-center">FBS Управление остатками</span></div>
    {organizations.map((organization) => {
      const permission = permissionFor(organization.id);
      return <div key={organization.id} className="grid min-w-[620px] grid-cols-[minmax(220px,1fr)_150px_210px] items-center border-t border-[var(--border)] px-4 py-3"><span className="font-medium">{organization.displayName}</span><label className="flex justify-center"><input type="checkbox" checked={permission.canAssembly} onChange={(event) => toggle(organization.id, "canAssembly", event.target.checked)} disabled={disabled} className="h-5 w-5 accent-[var(--accent)]" /></label><label className="flex justify-center"><input type="checkbox" checked={permission.canStock} onChange={(event) => toggle(organization.id, "canStock", event.target.checked)} disabled={disabled} className="h-5 w-5 accent-[var(--accent)]" /></label></div>;
    })}
  </div>;
}

function ExistingUserCard({ user, organizations, currentUserId, onReload, onPassword }: { user: PortalUser; organizations: Organization[]; currentUserId: number; onReload: () => Promise<void>; onPassword: (title: string, value: string) => void }) {
  const own = user.id === currentUserId;
  const [name, setName] = useState(user.name);
  const [status, setStatus] = useState(user.status);
  const [isAdmin, setIsAdmin] = useState(user.is_admin);
  const [permissions, setPermissions] = useState(user.permissions);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function action(body: Record<string, unknown>) {
    setBusy(String(body.action));
    setError("");
    try {
      const response = await fetch("/api/fbs-portal/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, userId: user.id }) });
      const result = await response.json().catch(() => ({})) as { error?: string; temporaryPassword?: string };
      if (!response.ok) throw new Error(result.error || "Не удалось сохранить");
      if (result.temporaryPassword) onPassword(`Новый пароль для ${user.email}`, result.temporaryPassword);
      await onReload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить");
    } finally {
      setBusy("");
    }
  }

  return <article className={`rounded-2xl border p-5 ${status === "disabled" ? "border-red-500/25 bg-red-500/5 opacity-75" : "border-[var(--border)] bg-[var(--bg-card)]"}`}>
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3"><div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${isAdmin ? "bg-emerald-500/15 text-emerald-500" : "bg-[var(--accent)]/10 text-[var(--accent)]"}`}>{isAdmin ? <ShieldCheck size={23} /> : <UserRound size={23} />}</div><div className="min-w-0"><input value={name} onChange={(event) => setName(event.target.value)} disabled={own} className="w-full rounded-lg border border-transparent bg-transparent px-1 text-lg font-semibold outline-none focus:border-[var(--border)] disabled:opacity-100" /><div className="truncate px-1 text-sm text-[var(--text-muted)]">{user.email}</div></div></div>
      <div className="text-right text-xs text-[var(--text-muted)]">{user.last_login_at ? `Последний вход: ${new Date(user.last_login_at).toLocaleString("ru-RU")}` : "Ещё не входил"}{own && <div className="mt-1 font-semibold text-[var(--accent)]">Ваш аккаунт</div>}</div>
    </div>
    <PermissionGrid organizations={organizations} value={permissions} onChange={setPermissions} disabled={own} />
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isAdmin} onChange={(event) => setIsAdmin(event.target.checked)} disabled={own} className="h-5 w-5 accent-[var(--accent)]" />Администратор пользователей</label>
      {!own && <button type="button" onClick={() => setStatus((value) => value === "active" ? "disabled" : "active")} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${status === "disabled" ? "border-emerald-500/30 text-emerald-500" : "border-red-500/30 text-red-500"}`}><UserX size={17} />{status === "disabled" ? "Включить" : "Отключить"}</button>}
      <div className="flex-1" />
      {!own && <button type="button" onClick={() => void action({ action: "reset_password" })} disabled={Boolean(busy)} className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium disabled:opacity-50"><KeyRound size={17} />Новый пароль</button>}
      {!own && <button type="button" onClick={() => void action({ action: "update", name, status, isAdmin, permissions })} disabled={Boolean(busy)} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === "update" ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}Сохранить</button>}
    </div>
    {error && <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</div>}
  </article>;
}

export function FbsPortalUsersClient() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [creating, setCreating] = useState(false);
  const [passwordResult, setPasswordResult] = useState<{ title: string; value: string } | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/fbs-portal/users", { cache: "no-store" });
    const result = await response.json().catch(() => ({})) as Payload & { error?: string };
    if (!response.ok) throw new Error(result.error || "Не удалось загрузить сотрудников");
    setPayload(result);
    setPermissions((current) => current.length ? current : emptyPermissions(result.organizations));
  }, []);

  useEffect(() => {
    load().catch((cause) => setError(cause instanceof Error ? cause.message : "Не удалось загрузить сотрудников")).finally(() => setLoading(false));
  }, [load]);

  async function createUser() {
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/fbs-portal/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", name, email, isAdmin, permissions }) });
      const result = await response.json().catch(() => ({})) as { error?: string; temporaryPassword?: string };
      if (!response.ok || !result.temporaryPassword) throw new Error(result.error || "Не удалось создать сотрудника");
      setPasswordResult({ title: `Временный пароль для ${email}`, value: result.temporaryPassword });
      setName(""); setEmail(""); setIsAdmin(false);
      setPermissions(emptyPermissions(payload?.organizations || []));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось создать сотрудника");
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <div className="fbs-portal-content flex items-center justify-center py-12 text-[var(--text-muted)]"><Loader2 className="mr-2 animate-spin" />Загружаем сотрудников…</div>;
  return <main className="fbs-portal-content space-y-5">
    <header><h1 className="text-2xl font-bold">Сотрудники склада</h1><p className="mt-1 text-sm text-[var(--text-muted)]">Создавайте отдельные логины и выдавайте доступ только к нужным юрлицам и разделам.</p></header>
    {passwordResult && <section className="rounded-2xl border border-emerald-500/35 bg-emerald-500/10 p-5"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 shrink-0 text-emerald-500" /><div className="min-w-0 flex-1"><div className="font-semibold text-emerald-500">{passwordResult.title}</div><p className="mt-1 text-sm text-[var(--text-muted)]">Скопируйте сейчас. Позже этот пароль посмотреть нельзя — можно только создать новый.</p><div className="mt-3 flex gap-2"><code className="min-w-0 flex-1 overflow-x-auto rounded-xl bg-[var(--bg)] px-4 py-3 font-mono text-lg font-bold">{passwordResult.value}</code><button type="button" onClick={() => void navigator.clipboard.writeText(passwordResult.value)} className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-white"><Copy size={18} />Копировать</button></div></div></div></section>}
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5"><div className="mb-4 flex items-center gap-2 text-lg font-semibold"><Plus className="text-[var(--accent)]" />Добавить сотрудника</div><div className="grid gap-3 md:grid-cols-2"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Имя сотрудника" className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3" /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email для входа" className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3" /></div><div className="mt-4"><PermissionGrid organizations={payload?.organizations || []} value={permissions} onChange={setPermissions} /></div><div className="mt-4 flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isAdmin} onChange={(event) => setIsAdmin(event.target.checked)} className="h-5 w-5 accent-[var(--accent)]" />Может добавлять сотрудников и менять права</label><div className="flex-1" /><button type="button" onClick={() => void createUser()} disabled={creating || !name || !email} className="flex items-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3 font-semibold text-white disabled:opacity-45">{creating ? <Loader2 size={19} className="animate-spin" /> : <Plus size={19} />}Создать пользователя</button></div></section>
    {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-500">{error}</div>}
    <section className="space-y-4">{payload?.users.map((user) => <ExistingUserCard key={`${user.id}:${user.status}:${user.is_admin}:${JSON.stringify(user.permissions)}`} user={user} organizations={payload.organizations} currentUserId={payload.currentUserId} onReload={load} onPassword={(title, value) => setPasswordResult({ title, value })} />)}</section>
  </main>;
}
