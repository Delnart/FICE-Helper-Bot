import { IsISO8601, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Allowed characters in a person's full name. Tightened from `\p{L}`, which
 * inadvertently let through letter-like symbols and some emoji-adjacent
 * characters; we now restrict to two specific scripts:
 *
 *   • Latin script (with diacritics — covers «André», «Müller», etc.)
 *   • Cyrillic script (Ukrainian + Russian + variants)
 *   • space, hyphen, apostrophes (`'` U+0027 and `’` U+2019)
 *   • dot (J. K. Rowling — initialed names are still names)
 *
 * Digits, emoji, math/symbol characters, punctuation, fullwidth forms, etc.
 * are all rejected so journals / queues / homework lists stay readable.
 */
const FULL_NAME_RE = /^[\p{Script=Latin}\p{Script=Cyrillic}\s.'’\-]+$/u;

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(FULL_NAME_RE, {
    message:
      'ПІБ має містити лише літери, пробіл, дефіс або апостроф. ' +
      'Емодзі та цифри не допускаються.',
  })
  fullName?: string;

  @IsOptional()
  @IsISO8601()
  birthday?: string;
}
