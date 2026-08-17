"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Plus, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

export interface OrganizationOption {
  id: number;
  slug: string;
  displayName: string;
  legalName: string;
  inn: string | null;
  supplierId: string | null;
  storeName: string | null;
  role: "owner" | "admin" | "member" | "viewer";
  isDefault: boolean;
  status: "active" | "setup";
}

export interface OrganizationsPayload {
  activeOrganizationId: number;
  isSystemAdmin: boolean;
  organizations: OrganizationOption[];
}

export function OrganizationSwitcher({
  payload,
}: {
  payload: OrganizationsPayload | null;
}) {
  const [open, setOpen] = useState(false);
  const [switchingId, setSwitchingId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!payload || payload.organizations.length === 0) return null;
  const active = payload.organizations.find((item) => item.id === payload.activeOrganizationId)
    || payload.organizations[0];

  async function switchOrganization(organizationId: number) {
    if (organizationId === active.id || switchingId !== null) {
      setOpen(false);
      return;
    }
    setSwitchingId(organizationId);
    try {
      const response = await fetch("/api/organizations/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      if (!response.ok) throw new Error("Не удалось переключить профиль");
      // A hard reload is deliberate: no React/IndexedDB/request cache from the
      // previous legal entity may survive a profile switch.
      window.location.reload();
    } catch (error) {
      setSwitchingId(null);
      window.alert(error instanceof Error ? error.message : "Не удалось переключить профиль");
    }
  }

  async function createOrganization() {
    if (creating || switchingId !== null) return;
    const displayName = window.prompt("Название нового профиля / юрлица");
    if (!displayName?.trim()) return;
    setCreating(true);
    try {
      const response = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: displayName.trim(), legalName: displayName.trim() }),
      });
      const result = await response.json().catch(() => ({})) as { organization?: { id?: number }; error?: string };
      if (!response.ok || !result.organization?.id) throw new Error(result.error || "Не удалось создать профиль");
      await switchOrganization(result.organization.id);
    } catch (error) {
      setCreating(false);
      window.alert(error instanceof Error ? error.message : "Не удалось создать профиль");
    }
  }

  return (
    <div ref={rootRef} className="relative z-[80] mt-2 w-full">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-10 w-full min-w-0 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-left transition-colors hover:bg-[var(--bg-card-hover)]"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <UserRound size={16} className="shrink-0 text-[var(--accent)]" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text)]">{active.displayName}</span>
        {switchingId !== null
          ? <Loader2 size={15} className="shrink-0 animate-spin text-[var(--accent)]" />
          : <ChevronDown size={15} className={cn("shrink-0 text-[var(--text-muted)] transition-transform", open && "rotate-180")} />}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 mt-2 w-[320px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-1.5 shadow-2xl shadow-black/25"
        >
          <div className="px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Юридическое лицо
          </div>
          {payload.organizations.map((organization) => {
            const selected = organization.id === active.id;
            return (
              <button
                key={organization.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => switchOrganization(organization.id)}
                disabled={switchingId !== null}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                  selected ? "bg-[var(--accent)]/10" : "hover:bg-[var(--bg-card-hover)]",
                )}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--text-muted)]">
                  <UserRound size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[var(--text)]">{organization.displayName}</span>
                  <span className="block truncate text-xs text-[var(--text-muted)]">
                    {organization.status === "setup"
                      ? "Требуется подключить WB"
                      : [organization.legalName, organization.inn ? `ИНН ${organization.inn}` : ""].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {selected && <Check size={17} className="shrink-0 text-[var(--accent)]" />}
              </button>
            );
          })}
          {payload.isSystemAdmin && (
            <button
              type="button"
              onClick={createOrganization}
              disabled={creating || switchingId !== null}
              className="mt-1 flex w-full items-center gap-3 rounded-lg border-t border-[var(--border)] px-3 py-2.5 text-left text-sm text-[var(--accent)] transition-colors hover:bg-[var(--bg-card-hover)] disabled:opacity-60"
            >
              {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Добавить юрлицо
            </button>
          )}
        </div>
      )}
    </div>
  );
}
