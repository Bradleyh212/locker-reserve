import { JwtModule } from '@nestjs/jwt'
import { Test, TestingModule } from '@nestjs/testing'
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
})
