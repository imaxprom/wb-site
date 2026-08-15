import { normalizeFbsScannerKeyboardText } from "@/lib/fbs-scanner-input";

const GROUP_SEPARATOR = "\u001d";
const AIM_GS1_DATAMATRIX_PREFIX = "]d2";

export type ParsedFbsDataMatrix = {
  value: string;
  gtin: string;
  serial: string;
  identity: string;
  format: "identification" | "crypto-91-92" | "crypto-93";
  separatorsRestored: boolean;
};

function invalid(message: string): never {
  throw new Error(`Это не код маркировки «Честного знака»: ${message}`);
}

function validGtinCheckDigit(gtin: string): boolean {
  if (!/^\d{14}$/.test(gtin)) return false;
  let sum = 0;
  for (let index = 12; index >= 0; index -= 1) {
    sum += Number(gtin[index]) * ((12 - index) % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === Number(gtin[13]);
}

function validGs1Text(value: string): boolean {
  return value.length > 0 && /^[\x21-\x7e]+$/.test(value);
}

/**
 * Keyboard scanners commonly append Enter and may prepend the AIM symbology
 * identifier ]d2. Neither is part of the value sent to WB. ASCII 29 inside
 * the code is significant and must never be trimmed or replaced.
 */
export function normalizeFbsDataMatrix(raw: string): string {
  const withoutTerminator = normalizeFbsScannerKeyboardText(raw.replace(/[\r\n]+$/g, ""));
  return withoutTerminator.startsWith(AIM_GS1_DATAMATRIX_PREFIX)
    ? withoutTerminator.slice(AIM_GS1_DATAMATRIX_PREFIX.length)
    : withoutTerminator;
}

export function parseFbsDataMatrix(raw: string): ParsedFbsDataMatrix {
  let value = normalizeFbsDataMatrix(raw);
  if (!value) invalid("сканер передал пустое значение");
  if (value.startsWith("*")) invalid("отсканирована этикетка WB, а не DataMatrix");
  if (value.length > 135) invalid("код имеет недопустимую длину");
  if (!value.startsWith("01")) invalid("нет обязательного идентификатора 01 (GTIN)");

  const gtin = value.slice(2, 16);
  if (!/^\d{14}$/.test(gtin)) invalid("GTIN должен состоять из 14 цифр");
  if (!validGtinCheckDigit(gtin)) invalid("неверная контрольная цифра GTIN");
  if (value.slice(16, 18) !== "21") invalid("нет обязательного идентификатора 21 (серийный номер)");

  let payload = value.slice(18);
  let firstSeparator = payload.indexOf(GROUP_SEPARATOR);
  let separatorsRestored = false;

  // Some keyboard-wedge scanners and browser inputs suppress ASCII 29 even
  // though FNC1 is present in the physical DataMatrix. For the standard ChZ
  // layouts the missing separators can be restored without guessing because
  // serial and AI 91 key lengths are fixed. WB still performs final validation.
  if (firstSeparator === -1 && ![6, 13].includes(payload.length)) {
    for (const serialLength of [13, 6]) {
      const serialCandidate = payload.slice(0, serialLength);
      const ai91 = payload.slice(serialLength, serialLength + 2);
      const verificationKey = payload.slice(serialLength + 2, serialLength + 6);
      const ai92 = payload.slice(serialLength + 6, serialLength + 8);
      const verificationCode = payload.slice(serialLength + 8);
      if (
        serialCandidate.length === serialLength
        && validGs1Text(serialCandidate)
        && ai91 === "91"
        && verificationKey.length === 4
        && validGs1Text(verificationKey)
        && ai92 === "92"
        && verificationCode.length >= 4
        && verificationCode.length <= 88
        && validGs1Text(verificationCode)
      ) {
        payload = `${serialCandidate}${GROUP_SEPARATOR}91${verificationKey}${GROUP_SEPARATOR}92${verificationCode}`;
        value = `${value.slice(0, 18)}${payload}`;
        firstSeparator = serialLength;
        separatorsRestored = true;
        break;
      }

      const ai93 = payload.slice(serialLength, serialLength + 2);
      const shortVerificationCode = payload.slice(serialLength + 2);
      if (
        serialCandidate.length === serialLength
        && validGs1Text(serialCandidate)
        && ai93 === "93"
        && shortVerificationCode.length >= 4
        && shortVerificationCode.length <= 88
        && validGs1Text(shortVerificationCode)
      ) {
        payload = `${serialCandidate}${GROUP_SEPARATOR}93${shortVerificationCode}`;
        value = `${value.slice(0, 18)}${payload}`;
        firstSeparator = serialLength;
        separatorsRestored = true;
        break;
      }
    }
  }

  const serial = firstSeparator === -1 ? payload : payload.slice(0, firstSeparator);
  if (![6, 13].includes(serial.length)) invalid("серийный номер должен содержать 6 или 13 символов");
  if (!validGs1Text(serial)) invalid("серийный номер содержит недопустимые символы");

  const identity = `01${gtin}21${serial}`;
  if (firstSeparator === -1) {
    if (value !== identity) invalid("после серийного номера обнаружены посторонние данные");
    return { value, gtin, serial, identity, format: "identification", separatorsRestored };
  }

  const cryptoParts = payload.slice(firstSeparator + 1).split(GROUP_SEPARATOR);
  if (cryptoParts.some((part) => !part)) invalid("пустая группа данных после FNC1-разделителя");
  if (cryptoParts.length === 2 && cryptoParts[0].startsWith("91") && cryptoParts[1].startsWith("92")) {
    const verificationKey = cryptoParts[0].slice(2);
    const verificationCode = cryptoParts[1].slice(2);
    if (verificationKey.length !== 4 || !validGs1Text(verificationKey)) invalid("неверный ключ проверки AI 91");
    if (verificationCode.length < 4 || verificationCode.length > 88 || !validGs1Text(verificationCode)) invalid("неверный код проверки AI 92");
    return { value, gtin, serial, identity, format: "crypto-91-92", separatorsRestored };
  }
  if (cryptoParts.length === 1 && cryptoParts[0].startsWith("93")) {
    const verificationCode = cryptoParts[0].slice(2);
    if (verificationCode.length < 4 || verificationCode.length > 88 || !validGs1Text(verificationCode)) invalid("неверный код проверки AI 93");
    return { value, gtin, serial, identity, format: "crypto-93", separatorsRestored };
  }
  invalid("не найдены корректные группы проверки AI 91/92 или AI 93");
}

export function sameFbsDataMatrixIdentity(left: string, right: string): boolean {
  try {
    return parseFbsDataMatrix(left).identity === parseFbsDataMatrix(right).identity;
  } catch {
    return false;
  }
}
