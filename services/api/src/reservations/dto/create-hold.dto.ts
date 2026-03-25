import { IsDateString, IsString } from 'class-validator';

export class CreateHoldDto {
	@IsString()
	lockerId: string;

	@IsDateString()
	startTime: string;

	@IsDateString()
	endTime: string;
}