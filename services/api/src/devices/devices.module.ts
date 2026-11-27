import { DeviceReliabilityService } from './device-reliability.service';
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
  exports: [DevicesService],
  controllers: [
    AdminDevicesController,
    DeviceController,
    AdminFirmwareReleasesController,
    AdminFirmwareUpdatesController,
    DeviceFirmwareController,
  ],
  providers: [DevicesService, DeviceReliabilityService, FirmwareService],
})
export class DevicesModule {}
