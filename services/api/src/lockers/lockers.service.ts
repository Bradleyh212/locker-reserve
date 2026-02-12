import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLockerDto } from './dto/create-locker.dto';

@Injectable()
export class LockersService {
	constructor(private prisma: PrismaService) {}

	findAll() {
		return this.prisma.locker.findMany({
			orderBy: { createdAt: 'desc' },
		});
	}

	async create(dto: CreateLockerDto) {
		try {
			return await this.prisma.locker.create({
				data: {
					code: dto.code,
					location: dto.location,
					isActive: dto.isActive ?? true,
				},
			});
		} catch (e: any) {
			// Prisma unique constraint violation
			if (e?.code === 'P2002') {
				throw new ConflictException(`Locker code "${dto.code}" already exists`);
			}
			throw e;
		}
	}
}
