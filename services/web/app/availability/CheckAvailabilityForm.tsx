'use client'

import { useState } from 'react'
import AvailabilityResults from './AvailabilityResults'

type Locker = {
	id: string
	code: string
	location: string
	isActive: boolean
	createdAt: string
	updatedAt: string
}

export default function CheckAvailabilityForm() {
	const [startTime, setStartTime] = useState('')
	const [endTime, setEndTime] = useState('')
	const [location, setLocation] = useState('')
	const [results, setResults] = useState<Locker[]>([])
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)
	const [searched, setSearched] = useState(false)

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault()
		setError(null)

		if (!startTime || !endTime) {
			setError('Start time and end time are required')
			return
		}

		if (new Date(endTime) <= new Date(startTime)) {
			setError('End time must be after start time')
			return
		}

		setLoading(true)
		setSearched(true)

		try {
			const params = new URLSearchParams({
				startTime: new Date(startTime).toISOString(),
				endTime: new Date(endTime).toISOString(),
			})

			if (location.trim()) {
				params.set('location', location.trim())
			}

			const res = await fetch(
				`http://localhost:3001/lockers/availability?${params.toString()}`
			)

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				setError(data?.message ?? `Request failed (${res.status})`)
				setResults([])
				return
			}

			setResults(data)
		} catch (e: any) {
			setError(e?.message ?? 'Network error')
			setResults([])
		} finally {
			setLoading(false)
		}
	}

	return (
		<section style={{ marginTop: 16 }}>
			<form onSubmit={onSubmit} style={{ display: 'grid', gap: 10, maxWidth: 500 }}>
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

				<label>
					Location (optional)
					<input
						type="text"
						value={location}
						onChange={(e) => setLocation(e.target.value)}
						placeholder="Site - Floor 1"
						style={{ width: '100%', padding: 8, display: 'block' }}
					/>
				</label>

				<button
					type="submit"
					disabled={loading}
					style={{
						padding: '8px 14px',
						backgroundColor: '#1f1f1f',
						color: 'white',
						border: '1px solid #555',
						borderRadius: 6,
						cursor: loading ? 'not-allowed' : 'pointer',
						opacity: loading ? 0.7 : 1,
					}}
				>
					{loading ? 'Checking...' : 'Check Availability'}
				</button>

				{error ? <p style={{ color: 'crimson' }}>{error}</p> : null}
			</form>

			{searched && !error ? <AvailabilityResults lockers={results} /> : null}
		</section>
	)
}