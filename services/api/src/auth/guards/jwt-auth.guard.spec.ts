import {
	ExecutionContext,
	InternalServerErrorException,
	UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { AUTH_COOKIE_NAME } from '../auth.constants'
import { JwtAuthGuard } from './jwt-auth.guard'

type TestRequest = {
	headers: {
		cookie?: string
	}
	admin?: unknown
}

function createContext(cookie?: string) {
	const request: TestRequest = {
		headers: {},
	}

	if (cookie) {
		request.headers.cookie = cookie
	}

	const context = {
		switchToHttp: () => ({
			getRequest: () => request,
		}),
	} as unknown as ExecutionContext

	return { context, request }
}

describe('JwtAuthGuard', () => {
	const originalJwtSecret = process.env.JWT_SECRET

	beforeEach(() => {
		if (originalJwtSecret === undefined) {
			delete process.env.JWT_SECRET
			return
		}

		process.env.JWT_SECRET = originalJwtSecret
	})

	afterAll(() => {
		if (originalJwtSecret === undefined) {
			delete process.env.JWT_SECRET
			return
		}

		process.env.JWT_SECRET = originalJwtSecret
	})

	it('returns 401 when the authentication cookie is missing', async () => {
		delete process.env.JWT_SECRET
		const guard = new JwtAuthGuard(new JwtService())
		const { context } = createContext()

		await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
			UnauthorizedException,
		)
	})

	it('returns 401 when the authentication cookie is invalid', async () => {
		process.env.JWT_SECRET = 'test-jwt-secret'
		const guard = new JwtAuthGuard(new JwtService())
		const { context } = createContext(`${AUTH_COOKIE_NAME}=invalid-token`)

		await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
			UnauthorizedException,
		)
	})

	it('rejects configured requests when the JWT secret is missing', async () => {
		delete process.env.JWT_SECRET
		const guard = new JwtAuthGuard(new JwtService())
		const { context } = createContext(`${AUTH_COOKIE_NAME}=token`)

		await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
			InternalServerErrorException,
		)
	})

	it('attaches the decoded admin claims when the authentication cookie is valid', async () => {
		process.env.JWT_SECRET = 'test-jwt-secret'
		const jwtService = new JwtService()
		const guard = new JwtAuthGuard(jwtService)
		const token = await jwtService.signAsync(
			{
				sub: 'admin@example.com',
				role: 'admin',
			},
			{
				secret: process.env.JWT_SECRET,
			},
		)
		const { context, request } = createContext(
			`theme=dark; ${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
		)

		await expect(guard.canActivate(context)).resolves.toBe(true)
		expect(request.admin).toMatchObject({
			sub: 'admin@example.com',
			role: 'admin',
		})
	})
})
