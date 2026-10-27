import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { RedisCacheService } from './cache/redis-cache.service';
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: PrismaService,
    private readonly cache: RedisCacheService,
  ) {}
  @Get()
  async readiness() {
    try {
      await this.db.$queryRaw`SELECT 1`;
      if (!(await this.cache.isHealthy())) throw new Error('Cache unavailable');
      return {
        service: 'locker-reserve-api',
        status: 'ok',
        runId: process.env.LOCAL_DEV_RUN_ID ?? null,
      };
    } catch {
      throw new ServiceUnavailableException('Dependencies unavailable');
    }
  }
}
