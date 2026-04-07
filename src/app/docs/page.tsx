"use client";

import { useState, useEffect } from "react";

interface DocBlock {
  type: "text" | "schema" | "list" | "code" | "linked-list";
  title?: string;
  content?: string;
  lines?: string[];
  items?: string[];
  language?: string;
  code?: string;
  file?: string;
  links?: { text: string; section: string; file?: string }[];
}

interface DocSection {
  id: string;
  icon: string;
  title: string;
  blocks: DocBlock[];
}

interface DocsData {
  sections: DocSection[];
}

function SchemaBlock({ title, lines }: { title?: string; lines: string[] }) {
  return (
    <div className="bg-[var(--bg)] border border-[var(--border)] rounded-xl p-4">
      {title && <h4 className="text-xs font-bold text-[var(--accent)] uppercase tracking-wider mb-2">{title}</h4>}
      <pre className="text-xs font-mono text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap">
        {lines.map((line, i) => (
          <div key={i} className={line === "" ? "h-2" : undefined}>
            {line.includes("→") || line.includes("↓") ? (
              <span>
                {line.split(/(→|↓|↗️|↘️)/).map((part, j) =>
                  part === "→" || part === "↓" || part === "↗️" || part === "↘️" ? (
                    <span key={j} className="text-[var(--accent)]">{part}</span>
                  ) : (
                    <span key={j}>{part}</span>
                  )
                )}
              </span>
            ) : (
              line
            )}
          </div>
        ))}
      </pre>
    </div>
  );
}

function ListBlock({ title, items }: { title?: string; items: string[] }) {
  return (
    <div>
      {title && <h4 className="text-sm font-semibold text-white mb-2">{title}</h4>}
      <div className="space-y-1.5">
        {items.map((item, i) => {
          const [bold, ...rest] = item.split(" — ");
          const desc = rest.join(" — ");
          return (
            <div key={i} className="flex gap-2 text-xs">
              <span className="text-[var(--accent)] mt-0.5 shrink-0">•</span>
              <span>
                {desc ? (
                  <>
                    <span className="text-white font-medium">{bold}</span>
                    <span className="text-[var(--text-muted)]"> — {desc}</span>
                  </>
                ) : (
                  <span className="text-[var(--text-muted)]">{item}</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CodeBlock({ title, code, file, autoOpen }: { title?: string; code: string; file?: string; autoOpen?: boolean }) {
  const [open, setOpen] = useState(false);
  const lines = code.split("\n").length;

  useEffect(() => {
    if (autoOpen) {
      setOpen(true);
    }
  }, [autoOpen]);

  return (
    <div className="border border-[var(--border)] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[var(--bg-card)] hover:bg-[var(--bg)] transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-[var(--accent)]">{open ? "▼" : "▶"}</span>
          <span className="text-sm font-medium text-white">{title || file || "Код"}</span>
          <span className="text-xs text-[var(--text-muted)]">({lines} строк)</span>
        </div>
        {file && <span className="text-xs text-[var(--text-muted)] font-mono">{file.split("/").pop()}</span>}
      </button>
      {open && (
        <pre className="p-4 text-xs font-mono text-[var(--text-muted)] leading-relaxed overflow-x-auto bg-[var(--bg)] max-h-[600px] overflow-y-auto">
          {code}
        </pre>
      )}
    </div>
  );
}

function LinkedListBlock({ title, links, onNavigate }: { title?: string; links: { text: string; section: string; file?: string }[]; onNavigate: (section: string, file?: string) => void }) {
  return (
    <div>
      {title && <h4 className="text-sm font-semibold text-white mb-2">{title}</h4>}
      <div className="space-y-1.5">
        {links.map((link, i) => {
          const fileName = link.text.split(" — ")[0];
          const desc = link.text.split(" — ").slice(1).join(" — ");
          return (
            <div key={i} className="flex gap-2 text-xs">
              <span className="text-[var(--accent)] mt-0.5 shrink-0">•</span>
              <span>
                <button
                  onClick={() => onNavigate(link.section, link.file)}
                  className="text-[var(--accent)] hover:underline font-medium cursor-pointer"
                >
                  {fileName}
                </button>
                {desc && <span className="text-[var(--text-muted)]"> — {desc}</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TextBlock({ content }: { content: string }) {
  const isWarning = content.startsWith("⚠️");
  return (
    <p
      className={`text-sm leading-relaxed ${
        isWarning
          ? "text-[var(--warning)] bg-[var(--warning)]/5 border border-[var(--warning)]/20 rounded-xl p-3"
          : "text-[var(--text-muted)]"
      }`}
    >
      {content}
    </p>
  );
}

export default function DocsPage() {
  const [data, setData] = useState<DocsData | null>(null);
  const [activeSection, setActiveSection] = useState<string>("");
  const [openFile, setOpenFile] = useState<string | undefined>(undefined);

  const navigateTo = (section: string, file?: string) => {
    setActiveSection(section);
    setOpenFile(file);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  useEffect(() => {
    fetch("/data/docs.json")
      .then((r) => r.json())
      .then((d: DocsData) => {
        setData(d);
        if (d.sections.length > 0) setActiveSection(d.sections[0].id);
      })
      .catch(() => {});
  }, []);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-[var(--text-muted)]">Загрузка руководства...</p>
      </div>
    );
  }

  const section = data.sections.find((s) => s.id === activeSection);

  return (
    <div className="flex gap-6 max-w-6xl">
      {/* Left nav */}
      <div className="w-48 shrink-0 hidden lg:block">
        <div className="sticky top-6 space-y-1">
          <h2 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-3">Разделы</h2>
          {data.sections.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                activeSection === s.id
                  ? "bg-[var(--accent)]/10 text-[var(--accent)] font-medium"
                  : "text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-card)]"
              }`}
            >
              {s.icon} {s.title}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 space-y-5">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white">📖 База знаний</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Как устроен каждый раздел MpHub</p>
        </div>

        {/* Mobile nav */}
        <div className="flex flex-wrap gap-1.5 lg:hidden">
          {data.sections.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                activeSection === s.id
                  ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10"
                  : "border-[var(--border)] text-[var(--text-muted)] hover:text-white"
              }`}
            >
              {s.icon} {s.title}
            </button>
          ))}
        </div>

        {/* Section content */}
        {section && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white">{section.icon} {section.title}</h2>
            {section.blocks.map((block, i) => (
              <div key={i}>
                {block.type === "text" && block.content && <TextBlock content={block.content} />}
                {block.type === "schema" && block.lines && <SchemaBlock title={block.title} lines={block.lines} />}
                {block.type === "list" && block.items && <ListBlock title={block.title} items={block.items} />}
                {block.type === "code" && block.code && <CodeBlock title={block.title} code={block.code} file={block.file} autoOpen={openFile === block.file} />}
                {block.type === "linked-list" && block.links && <LinkedListBlock title={block.title} links={block.links} onNavigate={navigateTo} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
