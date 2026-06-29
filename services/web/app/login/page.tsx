'use client'

import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiUrl, fetchAdminSession } from '../lib/auth'
import { getApiErrorMessage } from '../lib/ui'

export default function LoginPage() {
	const router = useRouter()
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)

	useEffect(() => {
		let active = true

		async function redirectIfAuthenticated() {
			try {
				const authenticated = await fetchAdminSession()

				if (active && authenticated) {
					router.replace('/')
				}
			} catch {
				// Stay on the login page when the session check cannot complete.
			}
		}

		redirectIfAuthenticated()

		return () => {
			active = false
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
				credentials: 'include',
				body: JSON.stringify({ email, password }),
			})

			const data = await res.json().catch(() => null)

			if (!res.ok || !data?.authenticated) {
				setError(
					getApiErrorMessage(
						data,
						(res.status === 401
							? 'Invalid email or password'
							: `Login failed (${res.status})`),
					),
				)
				return
			}

			router.replace('/')
		} catch (error: unknown) {
			setError(error instanceof Error ? error.message : 'Network error')
		} finally {
			setLoading(false)
		}
	}

	return (
		<main className="public-page" style={{ maxWidth: 480 }}>
			<section className="page-header">
				<div>
					<p className="eyebrow">Admin access</p>
					<h1 className="page-title">Sign in</h1>
					<p className="lede">
						Manage lockers, reservations, availability, and payments.
					</p>
				</div>
			</section>

			<form onSubmit={onSubmit} className="card card-pad form-grid">
				<label className="field">
					Email
					<input
						type="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						autoComplete="email"
					/>
				</label>

				<label className="field">
					Password
					<input
						type="password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						autoComplete="current-password"
					/>
				</label>

				<button
					type="submit"
					disabled={loading || !email.trim() || !password}
					className="button"
				>
					{loading ? 'Signing in...' : 'Sign in'}
				</button>

				{error ? <p className="alert alert-error">{error}</p> : null}
			</form>
		</main>
	)
}
