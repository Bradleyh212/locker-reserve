import {
	Injectable,
	InternalServerErrorException,
	UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import { AUTH_TOKEN_EXPIRES_IN } from './auth.constants'
import { LoginDto } from './dto/login.dto'

@Injectable()
export class AuthService {
	constructor(private readonly jwtService: JwtService) {}

	async login(dto: LoginDto) {
		const adminEmail = process.env.ADMIN_EMAIL
		const passwordHash = process.env.ADMIN_PASSWORD_HASH
		const jwtSecret = process.env.JWT_SECRET

		if (!adminEmail || !passwordHash || !jwtSecret) {
			throw new InternalServerErrorException('Admin auth is not configured')
		}

		if (!dto?.email || !dto?.password) {
			throw new UnauthorizedException('Invalid email or password')
		}

		const emailMatches =
			dto.email.trim().toLowerCase() === adminEmail.trim().toLowerCase()
		const passwordMatches = emailMatches
			? await bcrypt.compare(dto.password, passwordHash)
			: false

		if (!emailMatches || !passwordMatches) {
			throw new UnauthorizedException('Invalid email or password')
		}

		const accessToken = await this.jwtService.signAsync(
			{
				sub: adminEmail,
				role: 'admin',
			},
			{
				secret: jwtSecret,
				expiresIn: AUTH_TOKEN_EXPIRES_IN,
			},
		)

		return { accessToken }
	}
}
