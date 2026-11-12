import { Controller, Get, NotFoundException, Param, StreamableFile } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { BotService } from '../bot.service';

/** Where Telegram fetches a card's picture from, to show it as the link preview of the bot's message. */
@Controller('cards')
export class CardsController {
  constructor(private readonly bot: BotService) {}

  // No sign-in: Telegram has none, and the address holds the card's content hash, which only a message
  // carrying that card gives away.
  @Public()
  @Get(':file')
  card(@Param('file') file: string): StreamableFile {
    const png = this.bot.cardPng(file.replace(/\.png$/, ''));
    if (!png) throw new NotFoundException();
    return new StreamableFile(png, { type: 'image/png' });
  }
}
