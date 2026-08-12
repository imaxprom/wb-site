/**
 * Учет готовых рюкзаков на вкладке «Остатки».
 *
 * D — штук в коробке (защищенный норматив)
 * F — текущий остаток в коробках; введенное положительное число прибавляется
 * G — текущий остаток в штуках; введенное отрицательное число списывается
 *
 * Скрипт должен быть привязан к таблице «РЮКЗАКИ 8в1».
 */

const BACKPACK_STOCK = Object.freeze({
  sheetName: "Остатки",
  backupSheetName: "Резерв Остатки до учета 09.08.2026",
  logSheetName: "_Журнал учета рюкзаков",
  stateSheetName: "_Состояние учета рюкзаков",
  initializedProperty: "BACKPACK_STOCK_INITIALIZED_V1",
  firstProductRow: 2,
  nameColumn: 1,
  unitsPerBoxColumn: 4,
  boxesColumn: 6,
  piecesColumn: 7,
  mirrorPiecesColumn: 9,
});

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Учет рюкзаков")
    .addItem("Первичная настройка", "setupBackpackInventory")
    .addItem("Проверить остатки", "verifyBackpackInventory")
    .addSeparator()
    .addItem("Показать журнал", "showBackpackInventoryLog")
    .addItem("Скрыть журнал", "hideBackpackInventoryLog")
    .addToUi();
}

function setupBackpackInventory() {
  const spreadsheet = SpreadsheetApp.getActive();
  const sheet = spreadsheet.getSheetByName(BACKPACK_STOCK.sheetName);
  if (!sheet) throw new Error(`Не найдена вкладка «${BACKPACK_STOCK.sheetName}»`);

  const properties = PropertiesService.getDocumentProperties();
  if (properties.getProperty(BACKPACK_STOCK.initializedProperty) === "1") {
    SpreadsheetApp.getUi().alert("Учет уже настроен. Повторная инициализация запрещена, чтобы не восстановить списанные остатки.");
    return;
  }

  let backup = spreadsheet.getSheetByName(BACKPACK_STOCK.backupSheetName);
  if (!backup) {
    backup = sheet.copyTo(spreadsheet).setName(BACKPACK_STOCK.backupSheetName);
    backup.hideSheet();
  }

  const productRows = getBackpackProductRows_(sheet);
  if (!productRows.length) throw new Error("На вкладке «Остатки» не найдены товары");

  const invalidRows = productRows.filter((item) => !Number.isInteger(item.unitsPerBox) || item.unitsPerBox <= 0);
  if (invalidRows.length) {
    throw new Error(`Некорректное значение «Штук в коробке» в строках: ${invalidRows.map((item) => item.row).join(", ")}`);
  }

  const logSheet = getOrCreateLogSheet_(spreadsheet);
  const stateSheet = getOrCreateStateSheet_(spreadsheet);
  const initializedAt = new Date();
  const initialUser = getEditorEmail_();
  const stateRows = [];

  productRows.forEach((item) => {
    const pieces = Math.round(item.boxes * item.unitsPerBox);
    const boxes = roundBoxes_(pieces / item.unitsPerBox);

    sheet.getRange(item.row, BACKPACK_STOCK.boxesColumn).setValue(boxes);
    sheet.getRange(item.row, BACKPACK_STOCK.piecesColumn).setValue(pieces);
    sheet.getRange(item.row, BACKPACK_STOCK.mirrorPiecesColumn).setFormula(`=G${item.row}`);

    stateRows.push([item.row, item.name, item.unitsPerBox, boxes, pieces, initializedAt]);
    logSheet.appendRow([
      initializedAt,
      initialUser,
      item.row,
      item.name,
      "Начальный остаток",
      "",
      item.unitsPerBox,
      item.boxes,
      item.boxes * item.unitsPerBox,
      boxes,
      pieces,
    ]);
  });

  stateSheet.getRange(2, 1, Math.max(stateSheet.getMaxRows() - 1, 1), 6).clearContent();
  stateSheet.getRange(2, 1, stateRows.length, stateRows[0].length).setValues(stateRows);

  const lastProductRow = productRows[productRows.length - 1].row;
  sheet.getRange(BACKPACK_STOCK.firstProductRow, BACKPACK_STOCK.boxesColumn, lastProductRow - 1, 1)
    .setNumberFormat("0.####")
    .setNote("ПРИХОД: введите положительное количество новых коробок, например +5. Скрипт прибавит их к текущему остатку.");
  sheet.getRange(BACKPACK_STOCK.firstProductRow, BACKPACK_STOCK.piecesColumn, lastProductRow - 1, 1)
    .setNumberFormat("0")
    .setNote("ОТГРУЗКА: введите отрицательное количество отгруженных штук, например -15. Скрипт пересчитает остаток и дробное количество коробок.");
  sheet.getRange(BACKPACK_STOCK.firstProductRow, BACKPACK_STOCK.unitsPerBoxColumn, lastProductRow - 1, 1)
    .protect()
    .setDescription("Норматив: штук в коробке")
    .setWarningOnly(true);

  properties.setProperty(BACKPACK_STOCK.initializedProperty, "1");
  SpreadsheetApp.flush();
  spreadsheet.toast("Учет рюкзаков настроен. F — приход коробок, G — списание штук.", "Готово", 8);
}

function onEdit(event) {
  if (!event || !event.range) return;

  const range = event.range;
  const sheet = range.getSheet();
  if (sheet.getName() !== BACKPACK_STOCK.sheetName) return;

  const firstColumn = range.getColumn();
  const lastColumn = range.getLastColumn();
  const touchesControlledColumn = [
    BACKPACK_STOCK.unitsPerBoxColumn,
    BACKPACK_STOCK.boxesColumn,
    BACKPACK_STOCK.piecesColumn,
  ].some((column) => firstColumn <= column && lastColumn >= column);
  if (!touchesControlledColumn || range.getLastRow() < BACKPACK_STOCK.firstProductRow) return;

  const spreadsheet = event.source || SpreadsheetApp.getActive();
  if (PropertiesService.getDocumentProperties().getProperty(BACKPACK_STOCK.initializedProperty) !== "1") {
    spreadsheet.toast("Сначала запустите «Учет рюкзаков → Первичная настройка».", "Учет не включен", 8);
    return;
  }

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(15000)) {
    const stateSheet = spreadsheet.getSheetByName(BACKPACK_STOCK.stateSheetName);
    if (stateSheet) {
      const stateMap = readStateMap_(stateSheet);
      restoreControlledRows_(sheet, stateMap, range.getRow(), range.getLastRow());
    } else {
      restoreEventValue_(range, event.oldValue);
    }
    spreadsheet.toast("Другая операция еще выполняется. Повторите ввод через несколько секунд.", "Операция не принята", 8);
    return;
  }

  let stateForRecovery = null;
  try {
    const stateSheet = spreadsheet.getSheetByName(BACKPACK_STOCK.stateSheetName);
    if (!stateSheet) throw new Error("Не найдено служебное состояние учета");
    const stateMap = readStateMap_(stateSheet);

    if (range.getNumRows() !== 1 || range.getNumColumns() !== 1) {
      restoreControlledRows_(sheet, stateMap, range.getRow(), range.getLastRow());
      spreadsheet.toast("Массовая вставка в D, F или G запрещена. Вводите одну операцию в одну строку.", "Изменение отменено", 8);
      return;
    }

    const row = range.getRow();
    const column = range.getColumn();
    const state = stateMap.get(row);
    if (!state) {
      spreadsheet.toast("Эта строка не зарегистрирована в учете. Обратитесь к администратору.", "Изменение отменено", 8);
      restoreEventValue_(range, event.oldValue);
      return;
    }
    stateForRecovery = state;

    const currentName = String(sheet.getRange(row, BACKPACK_STOCK.nameColumn).getDisplayValue() || "").trim();
    if (currentName !== state.name) {
      restoreRow_(sheet, state);
      spreadsheet.toast("Строка товара была перемещена или переименована. Операция отменена.", "Нужна проверка", 8);
      return;
    }

    if (column === BACKPACK_STOCK.unitsPerBoxColumn) {
      restoreRow_(sheet, state);
      spreadsheet.toast("Количество штук в коробке защищено. Для изменения норматива обратитесь к администратору.", "Изменение отменено", 8);
      return;
    }

    const input = parseOperationNumber_(event.value, range.getFormula());
    if (!Number.isFinite(input)) {
      restoreRow_(sheet, state);
      spreadsheet.toast("Введите число: в F — +количество коробок, в G — -количество штук.", "Неверный ввод", 8);
      return;
    }

    let operation = "";
    let operationQuantity = 0;
    let piecesAfter = state.pieces;

    if (column === BACKPACK_STOCK.boxesColumn) {
      if (input <= 0 || !Number.isInteger(input)) {
        restoreRow_(sheet, state);
        spreadsheet.toast("В F можно только прибавлять целые коробки: например +5.", "Неверный приход", 8);
        return;
      }
      operation = "Приход коробок";
      operationQuantity = input;
      piecesAfter = state.pieces + input * state.unitsPerBox;
    } else if (column === BACKPACK_STOCK.piecesColumn) {
      if (input >= 0 || !Number.isInteger(input)) {
        restoreRow_(sheet, state);
        spreadsheet.toast("В G нужно вводить отрицательное целое число: например -15.", "Неверная отгрузка", 8);
        return;
      }
      operation = "Отгрузка штук";
      operationQuantity = input;
      piecesAfter = state.pieces + input;
      if (piecesAfter < 0) {
        restoreRow_(sheet, state);
        spreadsheet.toast(`Нельзя списать ${Math.abs(input)} шт.: доступно только ${state.pieces} шт.`, "Недостаточно остатка", 8);
        return;
      }
    } else {
      return;
    }

    const boxesAfter = roundBoxes_(piecesAfter / state.unitsPerBox);
    const nextState = {
      ...state,
      boxes: boxesAfter,
      pieces: piecesAfter,
    };
    restoreRow_(sheet, nextState);
    writeState_(stateSheet, nextState);
    appendOperationLog_(spreadsheet, {
      row,
      name: state.name,
      operation,
      operationQuantity,
      unitsPerBox: state.unitsPerBox,
      boxesBefore: state.boxes,
      piecesBefore: state.pieces,
      boxesAfter,
      piecesAfter,
    });

    spreadsheet.toast(
      `${state.name}: ${boxesAfter} кор. / ${piecesAfter} шт.`,
      operation === "Приход коробок" ? "Приход учтен" : "Отгрузка учтена",
      6,
    );
  } catch (error) {
    if (stateForRecovery) {
      try {
        restoreRow_(sheet, stateForRecovery);
      } catch (_) {
        // The visible error below remains the final safety signal if recovery itself fails.
      }
    }
    spreadsheet.toast(`Операция отменена: ${error instanceof Error ? error.message : String(error)}`, "Ошибка учета", 10);
  } finally {
    lock.releaseLock();
  }
}

function verifyBackpackInventory() {
  const spreadsheet = SpreadsheetApp.getActive();
  const sheet = spreadsheet.getSheetByName(BACKPACK_STOCK.sheetName);
  const stateSheet = spreadsheet.getSheetByName(BACKPACK_STOCK.stateSheetName);
  if (!sheet || !stateSheet) {
    SpreadsheetApp.getUi().alert("Учет еще не настроен.");
    return;
  }

  const stateMap = readStateMap_(stateSheet);
  const errors = [];
  stateMap.forEach((state, row) => {
    const name = String(sheet.getRange(row, BACKPACK_STOCK.nameColumn).getDisplayValue() || "").trim();
    const unitsPerBox = Number(sheet.getRange(row, BACKPACK_STOCK.unitsPerBoxColumn).getValue());
    const boxes = Number(sheet.getRange(row, BACKPACK_STOCK.boxesColumn).getValue());
    const pieces = Number(sheet.getRange(row, BACKPACK_STOCK.piecesColumn).getValue());
    if (name !== state.name || unitsPerBox !== state.unitsPerBox || Math.abs(boxes - state.boxes) > 0.0001 || pieces !== state.pieces) {
      errors.push(row);
    }
  });

  SpreadsheetApp.getUi().alert(
    errors.length
      ? `Обнаружены несогласованные строки: ${errors.join(", ")}. Не проводите операции до проверки.`
      : `Проверка пройдена: ${stateMap.size} товарных строк, расхождений нет.`,
  );
}

function showBackpackInventoryLog() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(BACKPACK_STOCK.logSheetName);
  if (sheet) sheet.showSheet().activate();
}

function hideBackpackInventoryLog() {
  const spreadsheet = SpreadsheetApp.getActive();
  const sheet = spreadsheet.getSheetByName(BACKPACK_STOCK.logSheetName);
  if (sheet) {
    spreadsheet.getSheetByName(BACKPACK_STOCK.sheetName).activate();
    sheet.hideSheet();
  }
}

function getBackpackProductRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < BACKPACK_STOCK.firstProductRow) return [];
  const rows = sheet.getRange(BACKPACK_STOCK.firstProductRow, 1, lastRow - 1, BACKPACK_STOCK.piecesColumn).getValues();
  return rows
    .map((values, index) => ({
      row: BACKPACK_STOCK.firstProductRow + index,
      name: String(values[BACKPACK_STOCK.nameColumn - 1] || "").trim(),
      unitsPerBox: Number(values[BACKPACK_STOCK.unitsPerBoxColumn - 1]),
      boxes: toNonNegativeNumber_(values[BACKPACK_STOCK.boxesColumn - 1]),
    }))
    .filter((item) => item.name);
}

function getOrCreateLogSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(BACKPACK_STOCK.logSheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(BACKPACK_STOCK.logSheetName);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "Дата и время",
      "Пользователь",
      "Строка",
      "Товар",
      "Операция",
      "Количество операции",
      "Штук в коробке",
      "Коробок до",
      "Штук до",
      "Коробок после",
      "Штук после",
    ]);
    sheet.setFrozenRows(1);
  }
  sheet.hideSheet();
  return sheet;
}

function getOrCreateStateSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(BACKPACK_STOCK.stateSheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(BACKPACK_STOCK.stateSheetName);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Строка", "Товар", "Штук в коробке", "Коробок", "Штук", "Обновлено"]);
    sheet.setFrozenRows(1);
  }
  sheet.hideSheet();
  return sheet;
}

function readStateMap_(sheet) {
  const result = new Map();
  if (sheet.getLastRow() < 2) return result;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  rows.forEach((values, index) => {
    const row = Number(values[0]);
    if (!Number.isInteger(row) || row < BACKPACK_STOCK.firstProductRow) return;
    result.set(row, {
      stateSheetRow: index + 2,
      row,
      name: String(values[1] || "").trim(),
      unitsPerBox: Number(values[2]),
      boxes: Number(values[3]),
      pieces: Number(values[4]),
    });
  });
  return result;
}

function writeState_(sheet, state) {
  sheet.getRange(state.stateSheetRow, 1, 1, 6).setValues([[
    state.row,
    state.name,
    state.unitsPerBox,
    state.boxes,
    state.pieces,
    new Date(),
  ]]);
}

function restoreControlledRows_(sheet, stateMap, firstRow, lastRow) {
  for (let row = firstRow; row <= lastRow; row += 1) {
    const state = stateMap.get(row);
    if (state) restoreRow_(sheet, state);
  }
}

function restoreRow_(sheet, state) {
  sheet.getRange(state.row, BACKPACK_STOCK.unitsPerBoxColumn).setValue(state.unitsPerBox);
  sheet.getRange(state.row, BACKPACK_STOCK.boxesColumn).setValue(state.boxes);
  sheet.getRange(state.row, BACKPACK_STOCK.piecesColumn).setValue(state.pieces);
  sheet.getRange(state.row, BACKPACK_STOCK.mirrorPiecesColumn).setFormula(`=G${state.row}`);
}

function restoreEventValue_(range, oldValue) {
  if (oldValue === undefined) range.clearContent();
  else range.setValue(oldValue);
}

function appendOperationLog_(spreadsheet, operation) {
  const sheet = getOrCreateLogSheet_(spreadsheet);
  sheet.appendRow([
    new Date(),
    getEditorEmail_(),
    operation.row,
    operation.name,
    operation.operation,
    operation.operationQuantity,
    operation.unitsPerBox,
    operation.boxesBefore,
    operation.piecesBefore,
    operation.boxesAfter,
    operation.piecesAfter,
  ]);
}

function parseOperationNumber_(eventValue, formula) {
  const formulaText = String(formula || "").trim();
  if (formulaText) {
    const match = formulaText.match(/^=\s*([+-]?\d+(?:[.,]\d+)?)\s*$/);
    if (!match) return NaN;
    return Number(match[1].replace(",", "."));
  }
  const normalized = String(eventValue ?? "").replace(/\s+/g, "").replace(",", ".");
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) return NaN;
  return Number(normalized);
}

function toNonNegativeNumber_(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function roundBoxes_(value) {
  return Math.round(value * 10000) / 10000;
}

function getEditorEmail_() {
  return Session.getActiveUser().getEmail() || "не определен";
}
