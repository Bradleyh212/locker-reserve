import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Injectable,
  Logger,
  Param,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { RedisCacheService } from '../cache/redis-cache.service';
import { CreateHoldDto } from '../reservations/dto/create-hold.dto';
import { CustomerAccessService } from './customer-access.service';
import { digest } from './access-policy';

@Injectable()
export class CustomerRequestGuard implements CanActivate {
  constructor(private cache: RedisCacheService) {}
  async canActivate(context: ExecutionContext) {
    const http = context.switchToHttp();
    http.getResponse<Response>().setHeader('Cache-Control', 'no-store');
    const req = http.getRequest<Request>();
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
      req.socket.remoteAddress ?? '',
    );
    if (!req.secure && (process.env.NODE_ENV === 'production' || !loopback))
      throw new ForbiddenException(
        'HTTPS is required for reservation credentials',
      );
    const peer = req.ip ?? 'unknown';
    await this.cache.limitAccess('ip:' + digest(peer), 120, 60);
    return true;
  }
}

@Controller('v1/customer/reservations')
@UseGuards(CustomerRequestGuard)
export class CustomerController {
  private logger = new Logger(CustomerController.name);
  constructor(private access: CustomerAccessService) {}

  @Post('hold')
  hold(
    @Body(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    dto: CreateHoldDto,
    @Req() req: Request,
  ) {
    return this.access.hold(dto, req.ip ?? 'unknown');
  }

  @Post(':id/payment-intent')
  payment(@Param('id') id: string, @Headers('authorization') header?: string) {
    return this.access.payment(id, header);
  }

  @Get(':id/access')
  readiness(
    @Param('id') id: string,
    @Headers('authorization') header?: string,
  ) {
    return this.access.readiness(id, header);
  }

  @Post(':id/unlock-requests')
  @HttpCode(202)
  async unlock(
    @Param('id') id: string,
    @Headers('authorization') header: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    try {
      if (
        body != null &&
        (typeof body !== 'object' ||
          Array.isArray(body) ||
          Object.keys(body).length)
      )
        throw new BadRequestException(
          'Unlock parameters are selected by the server',
        );
      return await this.access.unlock(id, header, key);
    } catch (error) {
      // Log only the decision; never log the header, body, token, or supplied path.
      this.logger.warn({
        event: 'customer_unlock_denied',
        resourceFingerprint: digest(id).slice(0, 16),
        status: error instanceof HttpException ? error.getStatus() : 500,
      });
      throw error;
    }
  }

  @Get(':id/unlock-requests')
  lookup(
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('authorization') header?: string,
  ) {
    return this.access.lookup(id, key, header);
  }

  @Get(':id/unlock-requests/:commandId')
  status(
    @Param('id') id: string,
    @Param('commandId') commandId: string,
    @Headers('authorization') header?: string,
  ) {
    return this.access.status(id, commandId, header);
  }
}
