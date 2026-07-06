import JSZip from "jszip";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadXlsx(
  input: ArrayBuffer,
  filename: string,
  options: { frozenRows?: number } = {}
) {
  const frozenRows = options.frozenRows ?? 0;
  let output: BlobPart = input;

  if (frozenRows > 0) {
    output = await freezeFirstWorksheetRows(input, frozenRows);
  }

  downloadBlob(new Blob([output], { type: XLSX_MIME }), filename);
}

async function freezeFirstWorksheetRows(input: ArrayBuffer, frozenRows: number): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(input);
  const worksheetPath = "xl/worksheets/sheet1.xml";
  const worksheetFile = zip.file(worksheetPath);
  if (!worksheetFile) return input;

  const xml = await worksheetFile.async("string");
  zip.file(worksheetPath, patchFrozenRows(xml, frozenRows));
  return zip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

function patchFrozenRows(xml: string, frozenRows: number) {
  const topLeftCell = `A${frozenRows + 1}`;
  const frozenSheetViews =
    `<sheetViews><sheetView workbookViewId="0">` +
    `<pane ySplit="${frozenRows}" topLeftCell="${topLeftCell}" activePane="bottomLeft" state="frozen"/>` +
    `<selection pane="bottomLeft" activeCell="${topLeftCell}" sqref="${topLeftCell}"/>` +
    `</sheetView></sheetViews>`;

  if (/<sheetViews[\s\S]*?<\/sheetViews>/.test(xml)) {
    return xml.replace(/<sheetViews[\s\S]*?<\/sheetViews>/, frozenSheetViews);
  }

  if (/<dimension\b[^>]*\/>/.test(xml)) {
    return xml.replace(/(<dimension\b[^>]*\/>)/, `$1${frozenSheetViews}`);
  }

  return xml.replace(/(<worksheet\b[^>]*>)/, `$1${frozenSheetViews}`);
}
