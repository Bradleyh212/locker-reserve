'use client'

import { useEffect, useMemo, useState } from 'react'
import { apiUrl, authFetch } from '../lib/auth'
import { getApiErrorMessage } from '../lib/ui'

type Locker = {
	id: string
	code: string
	location: string
	isActive: boolean
}

export default function CreateHoldForm({
	lockers,
	onChanged,
}: {
	lockers: Locker[]
	onChanged: () => void
}) {
	const activeLockers = useMemo(
		() => lockers.filter((l) => l.isActive),
		[lockers]
	)

	const [lockerId, setLockerId] = useState(activeLockers[0]?.id ?? '')
	const [startTime, setStartTime] = useState('')
	const [endTime, setEndTime] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [success, setSuccess] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)

	useEffect(() => {
		if (!activeLockers.some((locker) => locker.id === lockerId)) {
			setLockerId(activeLockers[0]?.id ?? '')
		}
	}, [activeLockers, lockerId])

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault()
		setError(null)
		setSuccess(null)

		if (new Date(endTime) <= new Date(startTime)) {
			setError('End time must be after start time')
			return
		}

		setLoading(true)

		try {
			const res = await authFetch(apiUrl('/reservations/hold'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					lockerId,
					startTime: new Date(startTime).toISOString(),
					endTime: new Date(endTime).toISOString(),
				}),
			})

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				setError(getApiErrorMessage(data, `Request failed (${res.status})`))
				return
			}

			setSuccess(`Hold created for locker ${data.locker.code}`)
			setStartTime('')
			setEndTime('')
			onChanged()
		} catch (e: any) {
			setError(e?.message ?? 'Network error')
		} finally {
			setLoading(false)
		}
	}

	return (
		<section className="card card-pad" style={{ marginBottom: 24 }}>
			<h2 className="section-title">Create hold</h2>
			<p className="metric-note" style={{ marginBottom: 16 }}>
				Create an admin hold for an active locker. Holds expire automatically.
			</p>

			<form onSubmit={onSubmit} className="form-grid form-grid-two">
				<label className="field">
					Locker
					<select
						value={lockerId}
						onChange={(e) => setLockerId(e.target.value)}
					>
						{activeLockers.map((locker) => (
							<option key={locker.id} value={locker.id}>
								{locker.code} — {locker.location}
							</option>
						))}
					</select>
				</label>

				<label className="field">
					Start time
					<input
						type="datetime-local"
						value={startTime}
						onChange={(e) => setStartTime(e.target.value)}
					/>
				</label>

				<label className="field">
					End time
					<input
						type="datetime-local"
						value={endTime}
						onChange={(e) => setEndTime(e.target.value)}
					/>
				</label>

				<button
					type="submit"
					disabled={loading || !lockerId || !startTime || !endTime}
					className="button"
				>
					{loading ? 'Creating...' : 'Create hold'}
				</button>

				{error ? <p className="alert alert-error">{error}</p> : null}
				{success ? <p className="alert alert-success">{success}</p> : null}
			</form>
		</section>
	)
}
