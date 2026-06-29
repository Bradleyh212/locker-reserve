import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'

type RedisCacheClient = {
	isOpen: boolean
	connect(): Promise<unknown>
	get(key: string): Promise<string | null>
	set(
		key: string,
		value: string,
		options: { expiration: { type: 'EX'; value: number } },
	): Promise<unknown>
	del(key: string | string[]): Promise<unknown>
	scanIterator(options: {
		MATCH: string
		COUNT: number
	}): AsyncIterable<string[]>
	close(): Promise<void>
	destroy(): void
	on(event: 'error', listener: (error: unknown) => void): unknown
}

type RedisPackage = {
	createClient(options: unknown): RedisCacheClient
}

@Injectable()
export class RedisCacheService implements OnModuleDestroy {
	private readonly logger = new Logger(RedisCacheService.name)
	private readonly redisUrl = process.env.REDIS_URL
	private client?: RedisCacheClient
	private connectPromise?: Promise<RedisCacheClient | null>

	async get<T>(key: string): Promise<T | null> {
		const client = await this.getClient()

		if (!client) {
			return null
		}

		try {
			const value = await client.get(key)
			return value ? (JSON.parse(value) as T) : null
		} catch (error) {
			this.warn('Redis get failed', error)
			return null
		}
	}

	async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
		const client = await this.getClient()

		if (!client) {
			return
		}

		try {
			await client.set(key, JSON.stringify(value), {
				expiration: {
					type: 'EX',
					value: ttlSeconds,
				},
			})
		} catch (error) {
			this.warn('Redis set failed', error)
		}
	}

	async delete(key: string): Promise<void> {
		const client = await this.getClient()

		if (!client) {
			return
		}

		try {
			await client.del(key)
		} catch (error) {
			this.warn('Redis delete failed', error)
		}
	}

	async deleteByPattern(pattern: string): Promise<void> {
		const client = await this.getClient()

		if (!client) {
			return
		}

		try {
			for await (const keys of client.scanIterator({
				MATCH: pattern,
				COUNT: 100,
			})) {
				if (keys.length > 0) {
					await client.del(keys)
				}
			}
		} catch (error) {
			this.warn('Redis deleteByPattern failed', error)
		}
	}

	async onModuleDestroy() {
		if (!this.client?.isOpen) {
			return
		}

		await this.client.close()
	}

	private async getClient(): Promise<RedisCacheClient | null> {
		if (!this.redisUrl) {
			return null
		}

		if (this.client?.isOpen) {
			return this.client
		}

		if (!this.client) {
			const { createClient } = require('redis') as RedisPackage

			this.client = createClient({
				url: this.redisUrl,
				socket: {
					connectTimeout: 500,
					reconnectStrategy: false,
				},
			})

			this.client.on('error', (error) => {
				this.warn('Redis client error', error)
			})
		}

		if (!this.connectPromise) {
			this.connectPromise = this.client
				.connect()
				.then(() => this.client ?? null)
				.catch((error) => {
					this.warn('Redis connection failed', error)
					this.client?.destroy()
					this.client = undefined
					return null
				})
				.finally(() => {
					this.connectPromise = undefined
				})
		}

		return this.connectPromise
	}

	private warn(message: string, error: unknown) {
		const detail = error instanceof Error ? error.message : String(error)
		this.logger.warn(`${message}: ${detail}`)
	}
}
