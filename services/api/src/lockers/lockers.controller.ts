import { Body, Controller, Get, Post } from '@nestjs/common';
import { LockersService } from './lockers.service';
import { CreateLockerDto } from './dto/create-locker.dto';

@Controller('lockers')
export class LockersController {
	constructor(private readonly lockersService: LockersService) {}

	@Get()
	findAll() {
		return this.lockersService.findAll();
	}

	@Post()
	create(@Body() dto: CreateLockerDto) {
		return this.lockersService.create(dto);
	}
}
