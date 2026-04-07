"use client";

import { useState, useRef, useEffect } from "react";
import { TOOLTIPS } from "@/lib/tooltips";

interface TooltipProps {
  term: string;
  children?: React.ReactNode;
}

export function Tooltip({ term, children }: TooltipProps) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<"top" | "bottom">("top");
  const triggerRef = useRef<HTMLSpanElement>(null);
  const text = TOOLTIPS[term];

  useEffect(() => {
    if (show && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      // If near top of screen, show below
      setPos(rect.top < 120 ? "bottom" : "top");
    }
  }, [show]);

  if (!text) return children ? <>{children}</> : null;

  return (
    <span className="relative inline-flex items-center">
      {children}
      <span
        ref={triggerRef}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(!show)}
        className="inline-flex items-center justify-center w-4 h-4 ml-1 rounded-full border border-[var(--border)] text-[9px] font-bold text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] cursor-help transition-colors shrink-0"
      >
        ?
      </span>
      {show && (
        <span
          className={`absolute z-50 w-64 px-3 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-xl text-xs text-[var(--text-muted)] leading-relaxed ${
            pos === "top"
              ? "bottom-full mb-2 left-1/2 -translate-x-1/2"
              : "top-full mt-2 left-1/2 -translate-x-1/2"
          }`}
        >
          {/* Arrow */}
          <span
            className={`absolute left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 border-[var(--border)] bg-[var(--bg-card)] ${
              pos === "top"
                ? "bottom-[-5px] border-b border-r"
                : "top-[-5px] border-t border-l"
            }`}
          />
          {text}
        </span>
      )}
    </span>
  );
}

/**
 * Inline tooltip — just the ? icon after text
 * Usage: <InfoTip term="r2" />
 */
export function InfoTip({ term }: { term: string }) {
  return <Tooltip term={term} />;
}
