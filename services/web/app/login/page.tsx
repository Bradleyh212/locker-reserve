'use client'

import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiUrl, getAdminToken, setAdminToken } from '../lib/auth'

export default function LoginPage() {
	const router = useRouter()
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)

	useEffect(() => {
		if (getAdminToken()) {
			router.replace('/')
		}
	}, [router])

	async function onSubmit(e: FormEvent) {
		e.preventDefault()
		setError(null)
		setLoading(true)

		try {
			const res = await fetch(apiUrl('/auth/login'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password }),
			})

			const data = await res.json().catch(() => null)

			if (!res.ok || !data?.accessToken) {
				setError(
					data?.message ??
						(res.status === 401
							? 'Invalid email or password'
							: `Login failed (${res.status})`),
				)
				return
			}

			setAdminToken(data.accessToken)
			router.replace('/')
		} catch (error: unknown) {
			setError(error instanceof Error ? error.message : 'Network error')
		} finally {
			setLoading(false)
		}
	}

	return (
		<main style={{ padding: 24, maxWidth: 420, margin: '0 auto' }}>
			<h1>Admin login</h1>

			<form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
				<label>
					Email
					<input
						type="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						autoComplete="email"
						style={{ width: '100%', padding: 8, display: 'block' }}
					/>
				</label>

				<label>
					Password
					<input
						type="password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						autoComplete="current-password"
						style={{ width: '100%', padding: 8, display: 'block' }}
					/>
				</label>

				<button
					type="submit"
					disabled={loading || !email.trim() || !password}
				>
					{loading ? 'Signing in...' : 'Sign in'}
				</button>

				{error ? <p style={{ color: 'crimson' }}>{error}</p> : null}
			</form>
		</main>
	)
}
