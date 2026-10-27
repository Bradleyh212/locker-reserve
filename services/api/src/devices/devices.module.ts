import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DevicesService } from './devices.service';
import { AdminDevicesController, DeviceController } from './devices.controller';
@Module({
  imports: [PrismaModule],
  controllers: [AdminDevicesController, DeviceController],
  providers: [DevicesService],
})
export class DevicesModule {}
