import { readFileSync } from 'fs';
import { createServer } from 'https';
import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });

  if (process.env.LOCAL_DEV_RUN_ID) app.enableShutdownHooks();

  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
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
