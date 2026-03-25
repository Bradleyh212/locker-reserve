'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

type Locker = {
	id: string
	code: string
	location: string
	isActive: boolean
}

export default function CreateHoldForm({ lockers }: { lockers: Locker[] }) {
	const router = useRouter()

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
			const res = await fetch('http://localhost:3001/reservations/hold', {
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
				setError(
					Array.isArray(data?.message)
						? data.message.join(', ')
						: data?.message ?? `Request failed (${res.status})`,
				)
				return
			}

			setSuccess(`Hold created for locker ${data.locker.code}`)
			setStartTime('')
			setEndTime('')
			router.refresh()
		} catch (e: any) {
			setError(e?.message ?? 'Network error')
		} finally {
			setLoading(false)
		}
	}

	return (
		<section style={{ marginTop: 16, marginBottom: 24 }}>
			<h2>Create hold</h2>

			<form onSubmit={onSubmit} style={{ display: 'grid', gap: 10, maxWidth: 500 }}>
				<label>
					Locker
					<select
						value={lockerId}
						onChange={(e) => setLockerId(e.target.value)}
						style={{
							width: '100%',
							padding: 10,
							display: 'block',
							backgroundColor: '#111',
							color: 'white',
							border: '1px solid #444',
							borderRadius: 6,
						}}
					>
						{activeLockers.map((locker) => (
							<option key={locker.id} value={locker.id}>
								{locker.code} — {locker.location}
							</option>
						))}
					</select>
				</label>

				<label>
					Start time
					<input
						type="datetime-local"
						value={startTime}
						onChange={(e) => setStartTime(e.target.value)}
						style={{ width: '100%', padding: 8, display: 'block' }}
					/>
				</label>

				<label>
					End time
					<input
						type="datetime-local"
						value={endTime}
						onChange={(e) => setEndTime(e.target.value)}
						style={{ width: '100%', padding: 8, display: 'block' }}
					/>
				</label>

				<button type="submit" disabled={loading || !lockerId || !startTime || !endTime}>
					{loading ? 'Creating...' : 'Create hold'}
				</button>

				{error ? <p style={{ color: 'crimson' }}>{error}</p> : null}
				{success ? <p style={{ color: 'green' }}>{success}</p> : null}
			</form>
		</section>
	)
}