import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLockerDto } from './dto/create-locker.dto';
import { UpdateLockerDto } from './dto/update-locker.dto';

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
			if (e?.code === 'P2002') {
				throw new ConflictException(`Locker code "${dto.code}" already exists`);
			}
			throw e;
		}
	}

	async update(id: string, dto: UpdateLockerDto) {
		try {
			return await this.prisma.locker.update({
				where: { id },
				data: dto,
			});
		} catch (e: any) {
			// Prisma "record not found"
			if (e?.code === 'P2025') {
				throw new NotFoundException(`Locker ${id} not found`);
			}
			throw e;
		}
	}
}
