import { Body, Controller, Get, Post } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { CreateHoldDto } from './dto/create-hold.dto';

@Controller('reservations')
export class ReservationsController {
	constructor(private readonly reservationsService: ReservationsService) {}

	@Get()
	findAll() {
		return this.reservationsService.findAll();
	}

	@Post('hold')
	createHold(@Body() dto: CreateHoldDto) {
		return this.reservationsService.createHold(dto);
	}
}