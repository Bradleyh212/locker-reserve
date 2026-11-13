import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { bearerHash, creationKey } from '../customer/access-policy';
import { ReservationCredentialGuard } from '../customer/reservation-credential.guard';
import { PaymentsService } from '../payments/payments.service';
import { CreateHoldDto } from './dto/create-hold.dto';
import { ReservationsService } from './reservations.service';

@Controller('public/reservations')
@UseGuards(ReservationCredentialGuard)
export class PublicReservationsController {
  constructor(
    private readonly holds: ReservationsService,
    private readonly payments: PaymentsService,
  ) {}
  @Post('hold')
  async hold(
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
    dto: CreateHoldDto,
    @Headers('authorization') header?: string,
    @Headers('idempotency-key') key?: string,
  ) {
    const hash = bearerHash(header);
    const r = await this.holds.createHold(dto, hash, creationKey(key));
    return this.payments.snapshot(r.id, hash);
  }
  @Get('recovery')
  async recover(
    @Headers('authorization') header?: string,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.payments.recover(creationKey(key), bearerHash(header));
  }
  @Get(':id')
  status(@Param('id') id: string, @Headers('authorization') header?: string) {
    return this.payments.status(id, bearerHash(header));
  }
  @Post(':id/cancel')
  async cancel(
    @Param('id') id: string,
    @Headers('authorization') header?: string,
  ) {
    const hash = bearerHash(header);
    await this.payments.owner(id, hash);
    await this.holds.cancel(id);
    await this.payments.reconcileReservation(id);
    return this.payments.snapshot(id, hash);
  }
}
