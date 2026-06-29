import { Module } from '@nestjs/common';
import { LockersController } from './lockers.controller';
import { LockersService } from './lockers.service';
import { PublicLockersController } from './public-lockers.controller';

@Module({
  controllers: [LockersController, PublicLockersController],
  providers: [LockersService],
})
export class LockersModule {}
