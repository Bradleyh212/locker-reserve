import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DevicesService } from './devices.service';

@Controller('v1/admin/devices')
@UseGuards(JwtAuthGuard)
export class AdminDevicesController {
  constructor(private readonly service: DevicesService) {}
  @Get() list() {
    return this.service.list();
  }
  @Post(':id/unlock-requests')
  @HttpCode(202)
  unlock(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: { admin?: { sub?: string } },
  ) {
    return this.service.enqueue(
      id,
      body,
      req.admin?.sub ?? 'authenticated-admin',
    );
  }
}

@Controller('v1/device')
export class DeviceController {
  constructor(private readonly service: DevicesService) {}
  @Post('heartbeat')
  @HttpCode(200)
  async heartbeat(
    @Headers('authorization') auth: string,
    @Body() body: unknown,
  ) {
    const d = await this.service.authenticate(auth);
    return this.service.heartbeat(d.id, body);
  }
  @Get('commands/next')
  async next(@Headers('authorization') auth: string, @Res() res: Response) {
    const d = await this.service.authenticate(auth);
    const c = await this.service.next(d.id);
    res.setHeader('Cache-Control', 'no-store');
    return c ? res.json(c) : res.status(204).send();
  }
  @Post('commands/:id/result')
  @HttpCode(200)
  async result(
    @Headers('authorization') auth: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const d = await this.service.authenticate(auth);
    return this.service.result(d.id, id, body);
  }
}
