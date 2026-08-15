"use client";

import type { Dispatch, KeyboardEvent, SetStateAction } from "react";
import {
  fbsEnglishScannerCharacter,
  normalizeFbsScannerKeyboardText,
} from "@/lib/fbs-scanner-input";

/**
 * Captures a keyboard-wedge scanner by physical key code and writes the
 * intended US-layout character straight into a controlled React input.
 */
export function captureFbsScannerKey(
  event: KeyboardEvent<HTMLInputElement>,
  setValue: Dispatch<SetStateAction<string>>,
): boolean {
  const character = fbsEnglishScannerCharacter({
    key: event.key,
    code: event.code,
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    isComposing: event.nativeEvent.isComposing,
  });
  if (character === null) return false;

  event.preventDefault();
  const input = event.currentTarget;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.setRangeText(character, start, end, "end");
  setValue(input.value);
  return true;
}

export function normalizeFbsScannerFieldValue(value: string): string {
  return normalizeFbsScannerKeyboardText(value);
}
