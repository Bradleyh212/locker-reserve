import { JwtModule } from '@nestjs/jwt'
import { GUARDS_METADATA } from '@nestjs/common/constants'
import { Test, TestingModule } from '@nestjs/testing'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { PaymentsController } from './payments.controller'
import { PaymentsService } from './payments.service'

describe('PaymentsController', () => {
	let controller: PaymentsController

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			imports: [JwtModule.register({ secret: 'test' })],
			controllers: [PaymentsController],
			providers: [
				{
					provide: PaymentsService,
					useValue: {},
				},
			],
		}).compile()

		controller = module.get<PaymentsController>(PaymentsController)
	})

	it('should be defined', () => {
		expect(controller).toBeDefined()
	})

	it('requires admin JWT for creating payment intents', () => {
		const guards = Reflect.getMetadata(GUARDS_METADATA, controller.createIntent)

		expect(guards).toContain(JwtAuthGuard)
	})

	it('keeps the Stripe webhook route public', () => {
		const controllerGuards = Reflect.getMetadata(
			GUARDS_METADATA,
			PaymentsController,
		)
		const webhookGuards = Reflect.getMetadata(
			GUARDS_METADATA,
			controller.handleWebhook,
		)

		expect(controllerGuards ?? []).not.toContain(JwtAuthGuard)
		expect(webhookGuards).toBeUndefined()
	})
})
