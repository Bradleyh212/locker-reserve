import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DevicesService } from './devices.service';
import { AdminDevicesController, DeviceController } from './devices.controller';
import {
  AdminFirmwareReleasesController,
  AdminFirmwareUpdatesController,
  DeviceFirmwareController,
} from './firmware.controller';
import { FirmwareService } from './firmware.service';
@Module({
  imports: [PrismaModule],
  controllers: [
    AdminDevicesController,
    DeviceController,
    DeviceFirmwareController,
    AdminFirmwareReleasesController,
    AdminFirmwareUpdatesController,
  ],
  providers: [DevicesService, FirmwareService],
})
export class DevicesModule {}
