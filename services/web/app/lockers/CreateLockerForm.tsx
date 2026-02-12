'use client'

import { useState } from 'react'

export default function CreateLockerForm() {
	const [code, setCode] = useState('')
	const [location, setLocation] = useState('')
	const [isActive, setIsActive] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [success, setSuccess] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault()
		setError(null)
		setSuccess(null)
		setLoading(true)

		try {
			const res = await fetch('http://localhost:3001/lockers', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ code, location, isActive }),
			})

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				setError(data?.message ?? `Request failed (${res.status})`)
				return
			}

			setSuccess(`Created locker ${data.code}`)
			setCode('')

			// easiest refresh for now
			window.location.reload()
		} catch (err: any) {
			setError(err?.message ?? 'Network error')
		} finally {
			setLoading(false)
		}
	}

	return (
		<section style={{ marginTop: 16 }}>
			<h2 style={{ marginBottom: 8 }}>Create locker</h2>

			<form onSubmit={onSubmit} style={{ display: 'grid', gap: 10 }}>
				<label>
					Code
					<input
						value={code}
						onChange={(e) => setCode(e.target.value)}
						placeholder="A-000"
						style={{ width: '100%', padding: 8, display: 'block' }}
					/>
				</label>

				<label>
					Location
					<input
						value={location}
						onChange={(e) => setLocation(e.target.value)}
						placeholder="Site - Floor 1"
						style={{ width: '100%', padding: 8, display: 'block' }}
					/>
				</label>

				<label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
					<input
						type="checkbox"
						checked={isActive}
						onChange={(e) => setIsActive(e.target.checked)}
					/>
					Active
				</label>

				<button type="submit" disabled={loading || !code.trim()}>
					{loading ? 'Creating...' : 'Create'}
				</button>

				{error ? <p style={{ color: 'crimson' }}>{error}</p> : null}
				{success ? <p style={{ color: 'green' }}>{success}</p> : null}
			</form>
		</section>
	)
}
