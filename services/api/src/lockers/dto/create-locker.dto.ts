import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class CreateLockerDto {
	@IsString()
	@Length(1, 50)
	code: string;

	@IsString()
	@Length(1, 100)
	location: string;

	@IsOptional()
	@IsBoolean()
	isActive?: boolean;
}
