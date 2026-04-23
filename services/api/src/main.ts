import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import 'dotenv/config'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  })

  app.enableCors({ origin: 'http://localhost:3000' })

  await app.listen(process.env.PORT ?? 3001)
}

bootstrap()