"use client";

import { useEffect } from "react";

export default function ModuleError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(`[reviews] error:`, error);
  }, [error]);

  return (
    <div className="p-8 max-w-xl mx-auto mt-20">
      <div className="bg-[var(--bg-card)] border border-[var(--danger)]/30 rounded-xl p-6">
        <h2 className="text-lg font-bold text-[var(--danger)] mb-2">
          Отзывы — ошибка
        </h2>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          Этот раздел временно недоступен. Остальные разделы работают.
        </p>
        <pre className="text-xs text-[var(--text-muted)] bg-[var(--bg)] rounded p-3 overflow-auto max-h-32">
          {error.message}
        </pre>
        <button
          onClick={reset}
          className="mt-4 px-4 py-2 bg-[var(--accent)] text-white rounded-lg text-sm hover:bg-[var(--accent-hover)] transition-colors"
        >
          Попробовать снова
        </button>
      </div>
    </div>
  );
}
