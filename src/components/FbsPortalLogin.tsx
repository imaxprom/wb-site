"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes, Loader2, ShieldCheck } from "lucide-react";

export function FbsPortalLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/fbs-portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; redirect?: string };
      if (!response.ok) throw new Error(result.error || "Не удалось войти");
      router.replace(result.redirect || "/fbs");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось войти");
    } finally {
      setLoading(false);
    }
  }

  return <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-5">
    <section className="w-full max-w-[430px] rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-7 shadow-2xl md:p-9">
      <div className="mb-7 flex flex-col items-center text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--accent)] text-white shadow-lg shadow-[var(--accent)]/20"><Boxes size={34} /></div>
        <h1 className="text-2xl font-bold">FBS Склад</h1>
        <p className="mt-2 text-base text-[var(--text-muted)]">Сборка, маркировка и управление остатками</p>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <label className="block"><span className="mb-1.5 block text-sm font-medium text-[var(--text-muted)]">Логин</span><input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3.5 text-base outline-none focus:border-[var(--accent)]" placeholder="name@example.com" required autoFocus /></label>
        <label className="block"><span className="mb-1.5 block text-sm font-medium text-[var(--text-muted)]">Пароль</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3.5 text-base outline-none focus:border-[var(--accent)]" placeholder="Введите пароль" required /></label>
        {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">{error}</div>}
        <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3.5 text-base font-semibold text-white disabled:opacity-50">{loading ? <Loader2 className="animate-spin" size={20} /> : <ShieldCheck size={20} />}{loading ? "Входим…" : "Войти"}</button>
      </form>
      <p className="mt-6 text-center text-xs text-[var(--text-muted)]">Доступ только для сотрудников склада</p>
    </section>
  </main>;
}
