import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common'
import type { Request, Response } from 'express'
import {
	AUTH_COOKIE_MAX_AGE_MS,
	AUTH_COOKIE_NAME,
} from './auth.constants'
import { AuthService } from './auth.service'
import { LoginDto } from './dto/login.dto'
import { JwtAuthGuard } from './guards/jwt-auth.guard'

type AdminRequest = Request & {
	admin?: unknown
}

@Controller('auth')
export class AuthController {
	constructor(private readonly authService: AuthService) {}

	@Post('login')
	async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
		const { accessToken } = await this.authService.login(dto)

		res.cookie(AUTH_COOKIE_NAME, accessToken, {
			httpOnly: true,
			sameSite: 'lax',
			secure: process.env.NODE_ENV === 'production',
			maxAge: AUTH_COOKIE_MAX_AGE_MS,
			path: '/',
		})

		return { authenticated: true }
	}

	@Post('logout')
	logout(@Res({ passthrough: true }) res: Response) {
		res.clearCookie(AUTH_COOKIE_NAME, {
			httpOnly: true,
			sameSite: 'lax',
			secure: process.env.NODE_ENV === 'production',
			path: '/',
		})

		return { authenticated: false }
	}

	@Get('me')
	@UseGuards(JwtAuthGuard)
	me(@Req() req: AdminRequest) {
		return {
			authenticated: true,
			admin: req.admin,
		}
	}
}
