import { Test, TestingModule } from '@nestjs/testing'
import { PrismaService } from '../prisma/prisma.service'
import { PaymentsService } from './payments.service'

describe('PaymentsService', () => {
	let service: PaymentsService

	beforeEach(async () => {
		process.env.STRIPE_SECRET_KEY = 'sk_test_123'

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				PaymentsService,
				{
					provide: PrismaService,
					useValue: {},
				},
			],
		}).compile()

		service = module.get<PaymentsService>(PaymentsService)
	})

	it('should be defined', () => {
		expect(service).toBeDefined()
	})
})
