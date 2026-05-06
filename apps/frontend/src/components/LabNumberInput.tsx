'use client';

import { useEffect, useState } from 'react';

const MAX_LAB = 50;

/**
 * Numeric input for lab numbers in the queue.
 *
 * Allows integers 1..50 *and* one-decimal sub-labs ("3.1", "3.2", …) so users
 * can write "лаба 3.1" without abusing the textarea. Two-decimal numbers
 * ("3.123") and other punctuation are stripped silently.
 *
 * <input type="number"> is intentionally avoided — it brings browser spinners
 * and a layout where you can't delete the lone digit "1" on mobile without
 * clearing the whole field first.
 */
export function LabNumberInput({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  // Local string state so the user can type "3.", clear the field, etc.,
  // without us snapping it back to a number on every keystroke.
  const [text, setText] = useState(formatNumber(value));
  useEffect(() => {
    setText(formatNumber(value));
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className="input"
      value={text}
      disabled={disabled}
      onChange={(e) => {
        const cleaned = sanitize(e.target.value);
        setText(cleaned);
        // Don't push transient values upstream: empty, lone dot, "3." (still typing).
        if (cleaned === '' || cleaned === '.' || cleaned.endsWith('.')) return;
        const n = Number(cleaned);
        if (!Number.isFinite(n)) return;
        const clamped = Math.min(MAX_LAB, Math.max(0.1, n));
        onChange(clamped);
      }}
      onBlur={() => {
        // Empty / mid-edit value on blur → snap back to last valid number.
        const n = Number(text);
        if (!text || !Number.isFinite(n) || n <= 0) {
          setText(formatNumber(value));
          return;
        }
        const clamped = Math.min(MAX_LAB, Math.max(0.1, n));
        const rounded = Math.round(clamped * 10) / 10; // ensure one decimal
        setText(formatNumber(rounded));
        if (rounded !== value) onChange(rounded);
      }}
    />
  );
}

/** "3" → "3", "3.0" → "3", "3.1" → "3.1". */
function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '1';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/**
 * Keep digits + at most one dot + at most one digit after the dot.
 * Cap total length so "100" / "3.55" can't sneak in.
 */
function sanitize(input: string): string {
  const replaced = input.replace(',', '.'); // accept "3,1" from RU/UK keyboards
  let dotSeen = false;
  let afterDot = 0;
  let out = '';
  for (const ch of replaced) {
    if (ch >= '0' && ch <= '9') {
      if (dotSeen) {
        if (afterDot >= 1) continue;
        afterDot++;
      }
      out += ch;
    } else if (ch === '.' && !dotSeen && out.length > 0) {
      out += '.';
      dotSeen = true;
    }
    if (out.length >= 4) break; // "50.9" / "100" never happens
  }
  return out;
}
