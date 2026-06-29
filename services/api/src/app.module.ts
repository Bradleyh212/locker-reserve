import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { PrismaModule } from './prisma/prisma.module'
import { LockersModule } from './lockers/lockers.module'
import { ReservationsModule } from './reservations/reservations.module'
import { PaymentsModule } from './payments/payments.module'
import { AuthModule } from './auth/auth.module'
import { RedisCacheModule } from './cache/redis-cache.module'
import { DashboardModule } from './dashboard/dashboard.module'

@Module({
	imports: [
		ScheduleModule.forRoot(),
		RedisCacheModule,
		PrismaModule,
		AuthModule,
		DashboardModule,
		LockersModule,
		ReservationsModule,
		PaymentsModule,
	],
	controllers: [AppController],
	providers: [AppService],
})
export class AppModule {}
