"use client";

import React from "react";

interface Props {
  moduleName: string;
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ModuleErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 max-w-xl mx-auto mt-20">
          <div className="bg-[var(--bg-card)] border border-[var(--danger)]/30 rounded-xl p-6">
            <h2 className="text-lg font-bold text-[var(--danger)] mb-2">
              {this.props.moduleName} — ошибка
            </h2>
            <p className="text-sm text-[var(--text-muted)] mb-4">
              Этот раздел временно недоступен. Остальные разделы работают.
            </p>
            <pre className="text-xs text-[var(--text-muted)] bg-[var(--bg)] rounded p-3 overflow-auto max-h-32">
              {this.state.error?.message}
            </pre>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="mt-4 px-4 py-2 bg-[var(--accent)] text-white rounded-lg text-sm hover:bg-[var(--accent-hover)] transition-colors"
            >
              Попробовать снова
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
