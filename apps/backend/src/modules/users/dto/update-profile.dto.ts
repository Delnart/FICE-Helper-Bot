import { IsISO8601, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Allowed characters in a person's full name:
 *   • Cyrillic letters (Ukrainian + Russian range U+0400..U+04FF)
 *   • Latin letters
 *   • space, hyphen, apostrophe (' and ’)
 *   • dot (J. K. Rowling — initialed names are still names)
 *
 * Anything else (digits, emoji, punctuation, math symbols) is rejected so the
 * journal / queue / homework lists stay readable. We also cap to 200 chars.
 */
const FULL_NAME_RE = /^[\p{L}Ѐ-ӿ\s.'’-]+$/u;

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
