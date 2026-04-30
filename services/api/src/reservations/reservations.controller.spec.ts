import { JwtModule } from '@nestjs/jwt'
import { GUARDS_METADATA } from '@nestjs/common/constants'
import { Test, TestingModule } from '@nestjs/testing'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { ReservationsController } from './reservations.controller'
import { ReservationsService } from './reservations.service'

describe('ReservationsController', () => {
	let controller: ReservationsController

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			imports: [JwtModule.register({ secret: 'test' })],
			controllers: [ReservationsController],
			providers: [
				{
					provide: ReservationsService,
					useValue: {},
				},
			],
		}).compile()

		controller = module.get<ReservationsController>(ReservationsController)
	})

	it('should be defined', () => {
		expect(controller).toBeDefined()
	})

	it('requires admin JWT for all reservation routes', () => {
		const guards = Reflect.getMetadata(GUARDS_METADATA, ReservationsController)

		expect(guards).toContain(JwtAuthGuard)
	})
})
