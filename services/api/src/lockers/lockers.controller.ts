import {
	Body,
	Controller,
	Get,
	Param,
	Patch,
	Post,
	Query,
	UseGuards,
} from '@nestjs/common'
import { LockersService } from './lockers.service'
import { CreateLockerDto } from './dto/create-locker.dto'
import { UpdateLockerDto } from './dto/update-locker.dto'
import { CheckAvailabilityDto } from './dto/check-availability.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'

@Controller('lockers')
@UseGuards(JwtAuthGuard)
export class LockersController {
	constructor(private readonly lockersService: LockersService) {}

	@Get()
	findAll() {
		return this.lockersService.findAll()
	}

	@Post()
	create(@Body() dto: CreateLockerDto) {
		return this.lockersService.create(dto)
	}

	@Patch(':id')
	update(@Param('id') id: string, @Body() dto: UpdateLockerDto) {
		return this.lockersService.update(id, dto)
	}

	@Get('availability')
	checkAvailability(@Query() dto: CheckAvailabilityDto) {
		return this.lockersService.checkAvailability(dto)
	}
}
