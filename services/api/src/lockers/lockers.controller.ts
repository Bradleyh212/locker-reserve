import { Controller, Get } from '@nestjs/common';
import { LockersService } from './lockers.service';

@Controller('lockers')
export class LockersController {
	constructor(private readonly lockersService: LockersService) {}

	@Get()
	findAll() {
		return this.lockersService.findAll();
	}
}
