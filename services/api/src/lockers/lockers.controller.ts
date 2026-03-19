import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { LockersService } from './lockers.service';
import { CreateLockerDto } from './dto/create-locker.dto';
import { UpdateLockerDto } from './dto/update-locker.dto';

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

	@Patch(':id')
	update(@Param('id') id: string, @Body() dto: UpdateLockerDto) {
		return this.lockersService.update(id, dto);
	}
}
