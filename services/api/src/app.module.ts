import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { LockersModule } from './lockers/lockers.module';
import { ReservationsModule } from './reservations/reservations.module';

@Module({
  imports: [PrismaModule, LockersModule, ReservationsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
