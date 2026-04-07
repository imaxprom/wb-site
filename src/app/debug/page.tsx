"use client";

import { useState } from "react";


export default function DebugPage() {
  const [data, setData] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const fetchSummary = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/wb/stocks-summary", {
        
      });
      const json = await res.json();
      setData(JSON.stringify(json, null, 2));
    } catch (err) {
      setData(String(err));
    }
    setLoading(false);
  };

  const fetchRaw = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/wb/stocks-raw", {
        
      });
      const json = await res.json();
      setData(JSON.stringify(json, null, 2));
    } catch (err) {
      setData(String(err));
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Debug: WB Stocks</h2>
      <div className="flex gap-3">
        <button
          onClick={fetchSummary}
          disabled={loading}
          className="px-5 py-2 bg-[var(--accent)] text-white rounded-lg"
        >
          {loading ? "..." : "Сводка остатков"}
        </button>
        <button
          onClick={fetchRaw}
          disabled={loading}
          className="px-5 py-2 border border-[var(--border)] text-white rounded-lg"
        >
          {loading ? "..." : "Сырые данные (5 шт)"}
        </button>
        <button
          onClick={async () => {
            setLoading(true);
            try {
              const res = await fetch("/api/wb/orders-stats", {
                
              });
              const json = await res.json();
              setData(JSON.stringify(json, null, 2));
            } catch (err) { setData(String(err)); }
            setLoading(false);
          }}
          disabled={loading}
          className="px-5 py-2 bg-[var(--success)] text-white rounded-lg"
        >
          {loading ? "..." : "Заказы с 19.02"}
        </button>
      </div>
      {data && (
        <pre className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4 text-xs overflow-auto max-h-[70vh] whitespace-pre-wrap">
          {data}
        </pre>
      )}
    </div>
  );
}
