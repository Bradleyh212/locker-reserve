import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices/devices.module';
import { PaymentsModule } from '../payments/payments.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { CustomerAccessService } from './customer-access.service';
import {
  CustomerController,
  CustomerRequestGuard,
} from './customer.controller';
@Module({
  imports: [ReservationsModule, PaymentsModule, DevicesModule],
  controllers: [CustomerController],
  providers: [CustomerAccessService, CustomerRequestGuard],
})
export class CustomerModule {}
