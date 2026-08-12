import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

const ROOT = process.cwd();
const CASE_DIR = path.join(ROOT, "reports", "pvz-case-43346319");
const SOURCE_DIR = path.join(CASE_DIR, "source");
const MARKED_DIR = path.join(CASE_DIR, "marked");
const OUTPUT_ZIP = path.join(CASE_DIR, "wb-weekly-full-marked-box-43346319.zip");

const reports = [
  {
    id: 758279672,
    period: "2026-06-15—2026-06-21",
    rows: [7897, 7898, 7899, 7900, 7901, 7902, 7903, 7904, 7905],
    note: "Обработка товара по всем девяти заданиям",
  },
  {
    id: 764633653,
    period: "2026-06-22—2026-06-28",
    rows: [24968, 24969],
    note: "Логистика 8736064100: 91,18 + 46,56 ₽",
  },
  {
    id: 764633898,
    period: "2026-06-22—2026-06-28",
    rows: [711, 712],
    note: "Логистика 8736035008: 131,82 + 67,00 ₽",
  },
  {
    id: 771262749,
    period: "2026-06-29—2026-07-05",
    rows: [78, 79],
    note: "Логистика 41988544570: 91,18 + 46,56 ₽",
  },
  {
    id: 778293741,
    period: "2026-07-06—2026-07-12",
    rows: [5122, 5123, 5155, 5165, 5166, 5168, 5184, 5211, 5230],
    note: "Возмещение за выдачу и возврат на ПВЗ по всем девяти заданиям: по 2,60 ₽",
  },
  {
    id: 784947745,
    period: "2026-07-13—2026-07-19",
    rows: [31567, 31568],
    note: "Логистика 55147690850: 91,06 + 46,56 ₽",
  },
  {
    id: 792104126,
    period: "2026-07-20—2026-07-26",
    rows: [15386, 15387, 16340, 23924],
    note: "Логистика 55146923467: 56,16 + 46,56 ₽; издержки 4,26 и 3,99 ₽",
  },
];

const evidenceColumns = new Set([
  "K",  // Обоснование для оплаты
  "AB", // Возмещение за выдачу и возврат товаров на ПВЗ
  "AI", // Количество доставок
  "AJ", // Количество возврата
  "AK", // Услуги по доставке товара покупателю
  "AQ", // Виды логистики, штрафов и корректировок ВВ
  "AR", // Стикер МП
  "AX", // Склад
  "BB", // Номер сборочного задания
  "BE", // Srid
  "BF", // Возмещение издержек по перевозке/складским операциям
]);

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function addHighlightStyles(stylesXml) {
  let yellowFillId;
  let orangeFillId;
  let yellowStyleId;
  let orangeStyleId;

  stylesXml = stylesXml.replace(
    /<fills count="(\d+)">([\s\S]*?)<\/fills>/,
    (match, countText, body) => {
      const count = Number(countText);
      yellowFillId = count;
      orangeFillId = count + 1;
      const yellow = '<fill><patternFill patternType="solid"><fgColor rgb="FFFFE699"></fgColor><bgColor indexed="64"></bgColor></patternFill></fill>';
      const orange = '<fill><patternFill patternType="solid"><fgColor rgb="FFF4B183"></fgColor><bgColor indexed="64"></bgColor></patternFill></fill>';
      return `<fills count="${count + 2}">${body}${yellow}${orange}</fills>`;
    },
  );

  stylesXml = stylesXml.replace(
    /<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/,
    (match, countText, body) => {
      const count = Number(countText);
      yellowStyleId = count;
      orangeStyleId = count + 1;
      const yellow = `<xf numFmtId="0" fontId="0" fillId="${yellowFillId}" borderId="0" xfId="0" applyFill="1"></xf>`;
      const orange = `<xf numFmtId="0" fontId="0" fillId="${orangeFillId}" borderId="0" xfId="0" applyFill="1"></xf>`;
      return `<cellXfs count="${count + 2}">${body}${yellow}${orange}</cellXfs>`;
    },
  );

  if ([yellowFillId, orangeFillId, yellowStyleId, orangeStyleId].some((value) => value === undefined)) {
    throw new Error("Не удалось добавить стили выделения в xl/styles.xml");
  }

  return { stylesXml, yellowStyleId, orangeStyleId };
}

function setCellStyle(cellXml, styleId) {
  if (/\ss="\d+"/.test(cellXml)) {
    return cellXml.replace(/\ss="\d+"/, ` s="${styleId}"`);
  }
  return cellXml.replace(/^<c\b/, `<c s="${styleId}"`);
}

function annotateRow(rowXml, yellowStyleId, orangeStyleId) {
  return rowXml.replace(/<c\b[\s\S]*?<\/c>/g, (cellXml) => {
    const ref = cellXml.match(/\sr="([A-Z]+)\d+"/)?.[1] || "";
    return setCellStyle(cellXml, evidenceColumns.has(ref) ? orangeStyleId : yellowStyleId);
  });
}

function annotateSheet(sheetXml, sourceRows, yellowStyleId, orangeStyleId) {
  const spreadsheetRows = sourceRows.map((rowNum) => rowNum + 1);
  const targetRows = new Set(spreadsheetRows);
  let matched = 0;

  sheetXml = sheetXml.replace(/<row\b[\s\S]*?<\/row>/g, (rowXml) => {
    const rowNumber = Number(rowXml.match(/\sr="(\d+)"/)?.[1] || 0);
    if (rowNumber === 1) {
      return rowXml.replace(/<c\b[\s\S]*?<\/c>/g, (cellXml) => {
        const ref = cellXml.match(/\sr="([A-Z]+)1"/)?.[1] || "";
        return evidenceColumns.has(ref) ? setCellStyle(cellXml, orangeStyleId) : cellXml;
      });
    }
    if (!targetRows.has(rowNumber)) return rowXml;
    matched += 1;
    return annotateRow(rowXml, yellowStyleId, orangeStyleId);
  });

  if (matched !== targetRows.size) {
    throw new Error(`В sheet1.xml найдено ${matched} из ${targetRows.size} заданных строк`);
  }

  return { sheetXml, spreadsheetRows };
}

function extractSingleXlsx(sourceZipPath) {
  const archive = new AdmZip(sourceZipPath);
  const entries = archive
    .getEntries()
    .filter((entry) => !entry.isDirectory && entry.entryName.toLowerCase().endsWith(".xlsx"));
  if (entries.length !== 1) {
    throw new Error(`${path.basename(sourceZipPath)}: ожидался один XLSX, найдено ${entries.length}`);
  }
  return entries[0].getData();
}

function annotateWorkbook(xlsxBuffer, sourceRows) {
  const workbook = new AdmZip(xlsxBuffer);
  const stylesEntry = workbook.getEntry("xl/styles.xml");
  const sheetEntry = workbook.getEntry("xl/worksheets/sheet1.xml");
  if (!stylesEntry || !sheetEntry) throw new Error("В XLSX не найдены styles.xml или sheet1.xml");

  const sourceSheetXml = sheetEntry.getData().toString("utf8");
  const sourceRowCount = (sourceSheetXml.match(/<row\b/g) || []).length;
  const sourceCellCount = (sourceSheetXml.match(/<c\b/g) || []).length;

  const styleResult = addHighlightStyles(stylesEntry.getData().toString("utf8"));
  const sheetResult = annotateSheet(
    sourceSheetXml,
    sourceRows,
    styleResult.yellowStyleId,
    styleResult.orangeStyleId,
  );

  const markedRowCount = (sheetResult.sheetXml.match(/<row\b/g) || []).length;
  const markedCellCount = (sheetResult.sheetXml.match(/<c\b/g) || []).length;
  if (markedRowCount !== sourceRowCount || markedCellCount !== sourceCellCount) {
    throw new Error(
      `Нарушена полнота листа: строки ${sourceRowCount}/${markedRowCount}, ячейки ${sourceCellCount}/${markedCellCount}`,
    );
  }

  workbook.updateFile("xl/styles.xml", Buffer.from(styleResult.stylesXml));
  workbook.updateFile("xl/worksheets/sheet1.xml", Buffer.from(sheetResult.sheetXml));
  return {
    buffer: workbook.toBuffer(),
    sourceRowCount,
    sourceCellCount,
    spreadsheetRows: sheetResult.spreadsheetRows,
  };
}

function buildReadme(results) {
  const lines = [
    "ПОЛНЫЕ ЕЖЕНЕДЕЛЬНЫЕ ОТЧЁТЫ WB — КОРОБ WB-MP-43346319",
    "",
    "Все исходные строки и все колонки отчётов сохранены.",
    "Жёлтая заливка — полная строка, относящаяся к одному из девяти спорных заказов.",
    "Оранжевая заливка — ключевые поля: вид операции, логистика, направление,",
    "стикер, номер сборочного задания, Srid и перевозочно-складские издержки.",
    "",
    "Важно: Excel-строка на 1 больше значения в колонке «№», поскольку строка 1 — заголовок.",
    "",
  ];

  for (const result of results) {
    lines.push(
      `Отчёт №${result.id}; период ${result.period}; полный лист: ${result.sourceRowCount - 1} строк данных.`,
      `Помечены значения «№»: ${result.rows.join(", ")}.`,
      `Excel-строки: ${result.spreadsheetRows.join(", ")}.`,
      `Содержание: ${result.note}.`,
      `Файл: ${result.fileName}`,
      "",
    );
  }

  lines.push(
    "Контрольные идентификаторы девяти заказов:",
    "8736064100 / 5191621364 / eI.rc9a40cbd99d9474f91626f55f545c2ea.0.0",
    "42372457536 / 5193132093 / ebi.rfffb8917a78d4517b3e22e2c7c9cafc3.5.0",
    "41988544570 / 5192899150 / eAp.ia08766e1722bffcc48ec03c92c6d9776.0.0",
    "8736035008 / 5191603204 / eZ.r21a8e780accc4340a7209bfb31b9fd2b.0.0",
    "42372457542 / 5193132095 / ebi.rfffb8917a78d4517b3e22e2c7c9cafc3.4.0",
    "42372476115 / 5193150781 / eBK.re9642a3fad3a4301ae6188ab66f6df96.0.0",
    "55152939218 / 5195877198 / eAZ.r9a85df8a2169486daa8ddc84db92c63e.0.0",
    "55147690850 / 5196019065 / ebr.if4c1afc797d0a5bfbc00df9a87a5a24f.0.0",
    "55146923467 / 5195167194 / eA1.r0ac6e8e5859d48d28baeccf52bb7aa2d.0.0",
    "",
    "Подготовлено по полным исходным архивам WB без удаления или фильтрации строк.",
  );
  return `${lines.join("\n")}\n`;
}

function main() {
  fs.mkdirSync(MARKED_DIR, { recursive: true });
  const results = [];

  for (const report of reports) {
    const sourcePath = path.join(SOURCE_DIR, `wb-weekly-${report.id}.zip`);
    if (!fs.existsSync(sourcePath)) throw new Error(`Нет исходного архива: ${sourcePath}`);

    const xlsxBuffer = extractSingleXlsx(sourcePath);
    const annotated = annotateWorkbook(xlsxBuffer, report.rows);
    const [periodFrom, periodTo] = report.period.split("—");
    const fileName = `WB_${report.id}_${periodFrom}_${periodTo}_marked.xlsx`;
    const outputPath = path.join(MARKED_DIR, fileName);
    fs.writeFileSync(outputPath, annotated.buffer);

    results.push({
      ...report,
      ...annotated,
      fileName,
      outputPath,
    });
    console.log(
      `OK #${report.id}: ${annotated.sourceRowCount - 1} строк данных, ` +
      `${annotated.sourceCellCount} ячеек, помечено ${report.rows.length} строк`,
    );
  }

  const readme = buildReadme(results);
  const readmePath = path.join(MARKED_DIR, "README_легенда.txt");
  fs.writeFileSync(readmePath, readme);

  const bundle = new AdmZip();
  bundle.addFile("README_легенда.txt", Buffer.from(readme));
  for (const result of results) {
    bundle.addLocalFile(result.outputPath);
  }
  bundle.writeZip(OUTPUT_ZIP);

  const manifest = {
    generatedAt: new Date().toISOString(),
    box: "WB-MP-43346319",
    supply: "WB-GI-246883602",
    fullReports: results.map((result) => ({
      reportId: result.id,
      period: result.period,
      sourceRows: result.rows,
      spreadsheetRows: result.spreadsheetRows,
      dataRows: result.sourceRowCount - 1,
      cells: result.sourceCellCount,
      output: path.relative(ROOT, result.outputPath),
      bytes: fs.statSync(result.outputPath).size,
    })),
    archive: path.relative(ROOT, OUTPUT_ZIP),
    archiveBytes: fs.statSync(OUTPUT_ZIP).size,
  };
  fs.writeFileSync(path.join(CASE_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`ARCHIVE ${OUTPUT_ZIP} ${manifest.archiveBytes} bytes`);
}

main();
