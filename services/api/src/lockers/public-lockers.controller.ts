import { Controller, Get, Query } from '@nestjs/common'
import { CheckAvailabilityDto } from './dto/check-availability.dto'
import { LockersService } from './lockers.service'

@Controller('public/lockers')
export class PublicLockersController {
	constructor(private readonly lockersService: LockersService) {}

	@Get('availability')
	checkAvailability(@Query() dto: CheckAvailabilityDto) {
		return this.lockersService.checkAvailability(dto)
	}
}
