import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class UpdateLockerDto {
	@IsOptional()
	@IsString()
	@Length(1, 50)
	code?: string;

	@IsOptional()
	@IsString()
	@Length(1, 100)
	location?: string;

	@IsOptional()
	@IsBoolean()
	isActive?: boolean;
}
