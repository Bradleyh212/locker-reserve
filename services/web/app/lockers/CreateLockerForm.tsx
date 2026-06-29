'use client'

import { useState } from 'react'
import { apiUrl, authFetch } from '../lib/auth'
import { getApiErrorMessage } from '../lib/ui'

export default function CreateLockerForm({
	onChanged,
}: {
	onChanged: () => void
}) {
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

		const trimmedCode = code.trim()
		const trimmedLocation = location.trim()

		if (!trimmedCode) {
			setError('Locker code is required.')
			return
		}

		if (!trimmedLocation) {
			setError('Location is required.')
			return
		}

		setLoading(true)

		try {
			const res = await authFetch(apiUrl('/lockers'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					code: trimmedCode,
					location: trimmedLocation,
					isActive,
				}),
			})

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				setError(getApiErrorMessage(data, `Request failed (${res.status})`))
				return
			}

			setSuccess(`Created locker ${data.code}`)
			setCode('')
			setLocation('')
			setIsActive(true)

			onChanged()
		} catch (err: any) {
			setError(err?.message ?? 'Network error')
		} finally {
			setLoading(false)
		}
	}

	return (
		<section className="card card-pad">
			<h2 className="section-title">Create locker</h2>
			<p className="metric-note" style={{ marginBottom: 16 }}>
				Add a locker with a short code and a clear customer-facing location.
			</p>

			<form onSubmit={onSubmit} className="form-grid">
				<label className="field">
					Code
					<input
						value={code}
						onChange={(e) => setCode(e.target.value)}
						placeholder="A-000"
						maxLength={50}
					/>
				</label>

				<label className="field">
					Location
					<input
						value={location}
						onChange={(e) => setLocation(e.target.value)}
						placeholder="Site - Floor 1"
						maxLength={100}
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

				<button
					type="submit"
					disabled={loading || !code.trim() || !location.trim()}
					className="button"
				>
					{loading ? 'Creating...' : 'Create'}
				</button>

				{error ? <p className="alert alert-error">{error}</p> : null}
				{success ? <p className="alert alert-success">{success}</p> : null}
			</form>
		</section>
	)
}
