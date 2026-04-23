import { IsDateString, IsOptional, IsString } from 'class-validator'

export class CheckAvailabilityDto {
	@IsDateString()
	startTime: string

	@IsDateString()
	endTime: string

	@IsOptional()
	@IsString()
	location?: string
}