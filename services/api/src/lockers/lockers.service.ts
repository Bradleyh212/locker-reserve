import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LockersService {
	constructor(private prisma: PrismaService) {}

	findAll() {
		return this.prisma.locker.findMany({
			orderBy: { createdAt: 'desc' },
		});
	}
}
