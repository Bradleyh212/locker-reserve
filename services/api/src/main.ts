import { readFileSync } from 'fs';
import { createServer } from 'https';
import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConsoleLogger } from '@nestjs/common';
import { configureProxy } from './proxy-config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    ...(process.env.NODE_ENV === 'production' && {
      logger: new ConsoleLogger({ json: true }),
    }),
  });

  configureProxy(app.getHttpAdapter().getInstance(), process.env);

  if (process.env.NODE_ENV === 'production' || process.env.LOCAL_DEV_RUN_ID)
    app.enableShutdownHooks();

  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
    exposedHeaders: ['Date'], // Let browsers display cooldowns against the API clock.
  });

  await app.listen(process.env.PORT ?? 3001);
  if (process.env.DEVICE_TLS_KEY && process.env.DEVICE_TLS_CERT) {
    createServer(
      {
        key: readFileSync(process.env.DEVICE_TLS_KEY),
        cert: readFileSync(process.env.DEVICE_TLS_CERT),
      },
      app.getHttpAdapter().getInstance(),
    ).listen(Number(process.env.DEVICE_TLS_PORT ?? 3443));
  }
}

bootstrap();
