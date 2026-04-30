import {
	CanActivate,
	ExecutionContext,
	Injectable,
	InternalServerErrorException,
	UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'

@Injectable()
export class JwtAuthGuard implements CanActivate {
	constructor(private readonly jwtService: JwtService) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest()
		const token = this.extractToken(request.headers.authorization)
		const jwtSecret = process.env.JWT_SECRET

		if (!jwtSecret) {
			throw new InternalServerErrorException('JWT secret is not configured')
		}

		if (!token) {
			throw new UnauthorizedException('Missing bearer token')
		}

		try {
			request.admin = await this.jwtService.verifyAsync(token, {
				secret: jwtSecret,
			})
		} catch {
			throw new UnauthorizedException('Invalid or expired token')
		}

		return true
	}

	private extractToken(authorization?: string): string | undefined {
		const [type, token] = authorization?.split(' ') ?? []

		return type === 'Bearer' ? token : undefined
	}
}
