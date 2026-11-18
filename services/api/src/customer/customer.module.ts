import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices/devices.module';
import { CustomerAccessService } from './customer-access.service';
import {
  CustomerController,
  CustomerRequestGuard,
} from './customer.controller';
@Module({
  imports: [DevicesModule],
  controllers: [CustomerController],
  providers: [CustomerAccessService, CustomerRequestGuard],
})
export class CustomerModule {}
