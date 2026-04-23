import { Controller, Post, Body } from '@nestjs/common'
import { PaymentsService } from './payments.service'

@Controller('payments')
export class PaymentsController {
	constructor(private paymentsService: PaymentsService) {}

	@Post('create-intent')
	async createIntent(@Body() body: { reservationId: string }) {
		return this.paymentsService.createPaymentIntent(body.reservationId)
	}
}