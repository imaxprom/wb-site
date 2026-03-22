"use client";

import { useState, useCallback } from "react";
import { parseExcelFile } from "@/lib/excel-parser";
import { useData } from "./DataProvider";

interface FileResult {
  name: string;
  stockCount: number;
  ordersCount: number;
  productsCount: number;
  sheets: string[];
}

export function FileUpload() {
  const { stock, orders, mergeUploadedData } = useData();
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<"idle" | "parsing" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [fileResults, setFileResults] = useState<FileResult[]>([]);

  const processFiles = useCallback(
    async (files: File[]) => {
      const validFiles = files.filter(
        (f) => f.name.endsWith(".xlsx") || f.name.endsWith(".xls")
      );

      if (validFiles.length === 0) {
        setStatus("error");
        setMessage("Поддерживаются только файлы .xlsx и .xls");
        return;
      }

      setStatus("parsing");
      setMessage(`Обработка ${validFiles.length} файл(ов)...`);
      setFileResults([]);

      const results: FileResult[] = [];

      try {
        for (const file of validFiles) {
          const buffer = await file.arrayBuffer();
          const result = parseExcelFile(buffer);

          // Merge into existing data (accumulate, not replace)
          mergeUploadedData({
            stock: result.stock,
            orders: result.orders,
          });

          results.push({
            name: file.name,
            stockCount: result.stock.length,
            ordersCount: result.orders.length,
            productsCount: result.products.length,
            sheets: result.sheetNames,
          });
        }

        setFileResults(results);
        setStatus("success");

        const totalStock = results.reduce((s, r) => s + r.stockCount, 0);
        const totalOrders = results.reduce((s, r) => s + r.ordersCount, 0);
        const totalProducts = results.reduce((s, r) => s + r.productsCount, 0);

        setMessage(
          `Обработано ${results.length} файл(ов). ` +
          `Найдено: ${totalStock} остатков, ${totalOrders} заказов, ${totalProducts} товаров. ` +
          `Все данные объединены.`
        );
      } catch (err) {
        setStatus("error");
        setMessage(
          `Ошибка парсинга: ${err instanceof Error ? err.message : "Неизвестная ошибка"}`
        );
      }
    },
    [mergeUploadedData]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) processFiles(files);
    },
    [processFiles]
  );

  const onFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) processFiles(files);
      // Reset input so the same file(s) can be selected again
      e.target.value = "";
    },
    [processFiles]
  );

  const hasExistingData = stock.length > 0 || orders.length > 0;

  return (
    <div className="space-y-4">
      <div
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        className={`
          border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer
          ${isDragging
            ? "border-[var(--accent)] bg-[var(--accent)]/5"
            : "border-[var(--border)] hover:border-[var(--text-muted)]"
          }
        `}
        onClick={() => document.getElementById("file-input")?.click()}
      >
        <div className="text-4xl mb-4">📄</div>
        <p className="text-lg font-medium">
          {isDragging ? "Отпустите файлы" : "Перетащите Excel файлы сюда"}
        </p>
        <p className="text-sm text-[var(--text-muted)] mt-2">
          или нажмите для выбора файлов (.xlsx) — можно несколько сразу
        </p>
        {hasExistingData && (
          <p className="text-xs text-[var(--accent)] mt-3">
            Новые данные будут объединены с уже загруженными
          </p>
        )}
        <input
          id="file-input"
          type="file"
          accept=".xlsx,.xls"
          multiple
          onChange={onFileInput}
          className="hidden"
        />
      </div>

      {status !== "idle" && (
        <div
          className={`rounded-lg p-4 text-sm ${
            status === "parsing"
              ? "bg-[var(--accent)]/10 text-[var(--accent)]"
              : status === "success"
              ? "bg-[var(--success)]/10 text-[var(--success)]"
              : "bg-[var(--danger)]/10 text-[var(--danger)]"
          }`}
        >
          {status === "parsing" && "⏳ "}
          {status === "success" && "✅ "}
          {status === "error" && "❌ "}
          {message}
        </div>
      )}

      {/* Per-file breakdown */}
      {fileResults.length > 1 && (
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <h4 className="text-sm font-medium text-[var(--text-muted)] mb-3">По файлам:</h4>
          <div className="space-y-2">
            {fileResults.map((r, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-sm py-1.5 px-2 rounded hover:bg-[var(--bg-card-hover)]"
              >
                <span className="font-medium truncate mr-4">{r.name}</span>
                <span className="text-[var(--text-muted)] whitespace-nowrap">
                  {r.stockCount > 0 && `${r.stockCount} остатков`}
                  {r.stockCount > 0 && r.ordersCount > 0 && " · "}
                  {r.ordersCount > 0 && `${r.ordersCount} заказов`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
