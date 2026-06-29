import { Body, Controller, Post } from '@nestjs/common'
import { CreateHoldDto } from './dto/create-hold.dto'
import { ReservationsService } from './reservations.service'

@Controller('public/reservations')
export class PublicReservationsController {
	constructor(private readonly reservationsService: ReservationsService) {}

	@Post('hold')
	createHold(@Body() dto: CreateHoldDto) {
		return this.reservationsService.createHold(dto)
	}
}
