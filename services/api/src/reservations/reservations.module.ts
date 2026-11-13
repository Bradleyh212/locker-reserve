import { PaymentsModule } from '../payments/payments.module';
import { Module } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { ReservationsController } from './reservations.controller';
import { PublicReservationsController } from './public-reservations.controller';

@Module({
  imports: [PaymentsModule],
  providers: [ReservationsService],
  controllers: [ReservationsController, PublicReservationsController]
})
export class ReservationsModule {}
