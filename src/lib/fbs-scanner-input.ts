const GROUP_SEPARATOR = "\u001d";

const RU_KEYS = "ёйцукенгшщзхъфывапролджэячсмитьбюЁЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮ";
const EN_KEYS = "`qwertyuiop[]asdfghjkl;'zxcvbnm,.~QWERTYUIOP{}ASDFGHJKL:\"ZXCVBNM<>";

const US_KEYBOARD_SYMBOLS: Record<string, readonly [string, string]> = {
  Backquote: ["`", "~"],
  Digit1: ["1", "!"],
  Digit2: ["2", "@"],
  Digit3: ["3", "#"],
  Digit4: ["4", "$"],
  Digit5: ["5", "%"],
  Digit6: ["6", "^"],
  Digit7: ["7", "&"],
  Digit8: ["8", "*"],
  Digit9: ["9", "("],
  Digit0: ["0", ")"],
  Minus: ["-", "_"],
  Equal: ["=", "+"],
  BracketLeft: ["[", "{"],
  BracketRight: ["]", "}"],
  Backslash: ["\\", "|"],
  Semicolon: [";", ":"],
  Quote: ["'", "\""],
  Comma: [",", "<"],
  Period: [".", ">"],
  Slash: ["/", "?"],
  Space: [" ", " "],
};

export type FbsScannerKeyboardEvent = {
  key: string;
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
};

/**
 * Repairs text already produced by a keyboard-wedge scanner while Windows was
 * using the Russian layout. ASCII characters and GS/FNC1 stay byte-for-byte
 * unchanged.
 */
export function normalizeFbsScannerKeyboardText(value: string): string {
  return Array.from(value, (character) => {
    const index = RU_KEYS.indexOf(character);
    return index >= 0 ? EN_KEYS[index] : character;
  }).join("");
}

/**
 * Returns the character encoded by the scanner's physical US-key position,
 * independently of the active Windows keyboard layout. This lets a controlled
 * input display English characters immediately instead of briefly showing
 * Cyrillic. Returns null for navigation/shortcut keys that the browser should
 * handle normally.
 */
export function fbsEnglishScannerCharacter(event: FbsScannerKeyboardEvent): string | null {
  if (event.isComposing) return null;
  if (event.key === GROUP_SEPARATOR || (event.ctrlKey && event.code === "BracketRight")) {
    return GROUP_SEPARATOR;
  }
  if (event.ctrlKey || event.altKey || event.metaKey) return null;

  if (/^Key[A-Z]$/.test(event.code)) {
    // `event.key` already contains the case that the scanner actually sent.
    // Rebuilding it from `shiftKey` loses Caps Lock/scanner case-conversion
    // state and corrupts mixed-case WB sticker barcodes. Normalize only the
    // keyboard layout here; keep physical-key reconstruction for punctuation.
    if (event.key.length === 1) return normalizeFbsScannerKeyboardText(event.key);
    const letter = event.code.slice(3);
    return event.shiftKey ? letter : letter.toLowerCase();
  }

  const symbol = US_KEYBOARD_SYMBOLS[event.code];
  if (symbol) return symbol[event.shiftKey ? 1 : 0];

  if (/^Numpad\d$/.test(event.code)) return event.code.slice(-1);
  if (event.code === "NumpadDecimal") return ".";
  if (event.code === "NumpadDivide") return "/";
  if (event.code === "NumpadMultiply") return "*";
  if (event.code === "NumpadSubtract") return "-";
  if (event.code === "NumpadAdd") return "+";

  return event.key.length === 1 ? normalizeFbsScannerKeyboardText(event.key) : null;
}
