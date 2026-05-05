"use client";

import { useState, useEffect, use } from "react";
import { AccountSettings } from "@/components/AccountSettings";

interface Account {
  id: number;
  name: string;
  store_name: string | null;
  inn: string | null;
  supplier_id: string | null;
  has_api_key: boolean;
  cookie_status: string;
  api_status: string;
  auto_replies: number;
  auto_dialogs: number;
  auto_complaints: number;
  use_auto_proxy: number;
  settings_json: string | null;
  has_wb_authorize_v3: boolean;
  has_wb_validation_key: boolean;
  wb_cookie_updated_at: string | null;
}

export default function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/reviews/accounts")
      .then((r) => r.json())
      .then((accounts: Account[]) => {
        const acc = accounts.find((a) => a.id === Number(id));
        setAccount(acc || null);
        setLoading(false);
      });
  }, [id]);

  async function handleSave(data: Partial<Account> & { settings_json?: string }) {
    await fetch(`/api/reviews/accounts/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  if (loading) {
    return <div className="flex items-center justify-center h-screen text-[var(--text-muted)]">Загрузка...</div>;
  }

  if (!account) {
    return (
      <div className="flex items-center justify-center h-screen text-[var(--text-muted)]">
        Аккаунт не найден
      </div>
    );
  }

  return (
    <AccountSettings account={account} onSave={handleSave} saved={saved} />
  );
}
