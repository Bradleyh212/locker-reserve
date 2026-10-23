import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DevicesService } from './devices.service';
import { FirmwareService } from './firmware.service';

@Controller('v1/device/firmware')
export class DeviceFirmwareController {
  constructor(
    private readonly devices: DevicesService,
    private readonly firmware: FirmwareService,
  ) {}

  @Get('next')
  async next(@Headers('authorization') auth: string, @Res() res: Response) {
    const device = await this.devices.authenticate(auth);
    const manifest = await this.firmware.next(device.id);
    res.setHeader('Cache-Control', 'no-store');
    return manifest ? res.status(200).json(manifest) : res.status(204).send();
  }

  @Get('updates/:id/download')
  async download(
    @Headers('authorization') auth: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const device = await this.devices.authenticate(auth);
    const download = await this.firmware.download(device.id, id);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(download.sizeBytes));
    res.setHeader('Cache-Control', 'no-store');
    download.stream.on('error', () => res.destroy());
    return download.stream.pipe(res);
  }

  @Post('updates/:id/result')
  @HttpCode(200)
  async result(
    @Headers('authorization') auth: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const device = await this.devices.authenticate(auth);
    return this.firmware.result(device.id, id, body);
  }
}

@Controller('v1/admin/firmware-releases')
@UseGuards(JwtAuthGuard)
export class AdminFirmwareReleasesController {
  constructor(private readonly firmware: FirmwareService) {}

  @Get()
  list(@Query('deviceId') deviceId: string) {
    return this.firmware.listReleases(deviceId);
  }
}

@Controller('v1/admin/devices')
@UseGuards(JwtAuthGuard)
export class AdminFirmwareUpdatesController {
  constructor(private readonly firmware: FirmwareService) {}

  @Post(':id/firmware-updates')
  @HttpCode(202)
  requestUpdate(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request & { admin?: { sub?: string } },
  ) {
    return this.firmware.requestUpdate(
      id,
      body,
      req.admin?.sub ?? 'authenticated-admin',
    );
  }

  @Get(':id/firmware-updates')
  list(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.firmware.listUpdates(id, limit);
  }
}
