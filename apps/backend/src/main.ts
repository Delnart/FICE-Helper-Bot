import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
    bodyParser: true,
  });
  // TLS terminates at a reverse proxy in front of :3000; trust private-network
  // hops so req.ip is the client (used by the login rate limit), not the proxy.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  // Run onModuleDestroy (bot.stop, Mongo close) on SIGTERM so `docker stop`
  // and deploys don't wait 10 s for SIGKILL.
  app.enableShutdownHooks();

  const logger = new Logger('Bootstrap');
  const corsOrigin = process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()) ?? ['*'];

  // The frontend is loaded inside Telegram's iframe, so we drop frameguard's
  // default X-Frame-Options (it would set SAMEORIGIN and break the Mini App).
  // The frontend sets its own CSP frame-ancestors that whitelists Telegram.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      frameguard: false,
    }),
  );
  app.use(compression());

  app.enableCors({
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  app.setGlobalPrefix('api');

  const port = parseInt(process.env.BACKEND_PORT ?? '3001', 10);
  await app.listen(port, '0.0.0.0');
  logger.log(`Backend listening on :${port}`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
