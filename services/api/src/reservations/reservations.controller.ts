import {
	Body,
	Controller,
	Get,
	Param,
	Patch,
	Post,
	UseGuards,
} from '@nestjs/common'
import { ReservationsService } from './reservations.service'
import { CreateHoldDto } from './dto/create-hold.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'

@Controller('reservations')
@UseGuards(JwtAuthGuard)
export class ReservationsController {
	constructor(private readonly reservationsService: ReservationsService) {}

	@Get()
	findAll() {
		return this.reservationsService.findAll()
	}

	@Post('hold')
	createHold(@Body() dto: CreateHoldDto) {
		return this.reservationsService.createHold(dto)
	}

	@Patch(':id/confirm')
	confirm(@Param('id') id: string) {
		return this.reservationsService.confirm(id)
	}

	@Patch(':id/cancel')
	cancel(@Param('id') id: string) {
		return this.reservationsService.cancel(id)
	}
}
