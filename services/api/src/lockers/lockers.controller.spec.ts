import { JwtModule } from '@nestjs/jwt'
import { GUARDS_METADATA } from '@nestjs/common/constants'
import { Test, TestingModule } from '@nestjs/testing'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { LockersController } from './lockers.controller'
import { LockersService } from './lockers.service'

describe('LockersController', () => {
	let controller: LockersController

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			imports: [JwtModule.register({ secret: 'test' })],
			controllers: [LockersController],
			providers: [
				{
					provide: LockersService,
					useValue: {},
				},
			],
		}).compile()

		controller = module.get<LockersController>(LockersController)
	})

	it('should be defined', () => {
		expect(controller).toBeDefined()
	})

	it('requires admin JWT for all locker routes', () => {
		const guards = Reflect.getMetadata(GUARDS_METADATA, LockersController)

		expect(guards).toContain(JwtAuthGuard)
	})
})
