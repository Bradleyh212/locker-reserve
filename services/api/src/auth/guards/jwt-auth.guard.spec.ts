import {
	ExecutionContext,
	InternalServerErrorException,
	UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { JwtAuthGuard } from './jwt-auth.guard'

type TestRequest = {
	headers: {
		authorization?: string
	}
	admin?: unknown
}

function createContext(authorization?: string) {
	const request: TestRequest = {
		headers: {},
	}

	if (authorization) {
		request.headers.authorization = authorization
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

	it('returns 401 when the bearer token is missing', async () => {
		delete process.env.JWT_SECRET
		const guard = new JwtAuthGuard(new JwtService())
		const { context } = createContext()

		await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
			UnauthorizedException,
		)
	})

	it('returns 401 when the bearer token is invalid', async () => {
		process.env.JWT_SECRET = 'test-jwt-secret'
		const guard = new JwtAuthGuard(new JwtService())
		const { context } = createContext('Bearer invalid-token')

		await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
			UnauthorizedException,
		)
	})

	it('rejects configured requests when the JWT secret is missing', async () => {
		delete process.env.JWT_SECRET
		const guard = new JwtAuthGuard(new JwtService())
		const { context } = createContext('Bearer token')

		await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
			InternalServerErrorException,
		)
	})

	it('attaches the decoded admin claims when the bearer token is valid', async () => {
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
		const { context, request } = createContext(`Bearer ${token}`)

		await expect(guard.canActivate(context)).resolves.toBe(true)
		expect(request.admin).toMatchObject({
			sub: 'admin@example.com',
			role: 'admin',
		})
	})
})
