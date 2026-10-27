import type { CSSProperties } from 'react';
import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Inline vars for the sliding selections in globals.css (.seg-slide, .days): chosen index, option count. */
export function slideVars(i: number, n?: number): CSSProperties {
  return { '--i': i, '--n': n } as CSSProperties;
}
