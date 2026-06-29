import {
	CanActivate,
	ExecutionContext,
	Injectable,
	InternalServerErrorException,
	UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import { AUTH_COOKIE_NAME } from '../auth.constants'

type AdminRequest = Request & {
	admin?: unknown
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
	constructor(private readonly jwtService: JwtService) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<AdminRequest>()
		const token = this.extractToken(request.headers.cookie)

		if (!token) {
			throw new UnauthorizedException('Missing authentication cookie')
		}

		const jwtSecret = process.env.JWT_SECRET

		if (!jwtSecret) {
			throw new InternalServerErrorException('JWT secret is not configured')
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

	private extractToken(cookieHeader?: string): string | undefined {
		const cookies = cookieHeader?.split(';') ?? []

		for (const cookie of cookies) {
			const [rawName, ...valueParts] = cookie.split('=')

			if (rawName?.trim() !== AUTH_COOKIE_NAME) {
				continue
			}

			const value = valueParts.join('=')

			return value ? decodeURIComponent(value) : undefined
		}

		return undefined
	}
}
