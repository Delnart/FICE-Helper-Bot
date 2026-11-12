/**
 * A quote block of a Telegram message: a tinted panel with a bar on its left, the nearest a text gets to a
 * card. A line for each thing there is to say; what is missing is passed as it is and leaves no line.
 */
export const quote = (...lines: Array<string | false | null | undefined>): string =>
  `<blockquote>${lines.filter(Boolean).join('\n')}</blockquote>`;
