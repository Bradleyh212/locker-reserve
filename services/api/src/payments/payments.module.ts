import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PublicPaymentsController } from './public-payments.controller';

@Module({
  providers: [PaymentsService],
  controllers: [PaymentsController, PublicPaymentsController]
})
export class PaymentsModule {}
