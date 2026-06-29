'use client'

import { useState } from 'react'
import { apiUrl, authFetch } from '../lib/auth'
import { getApiErrorMessage } from '../lib/ui'
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

			const res = await authFetch(
				apiUrl(`/lockers/availability?${params.toString()}`)
			)

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				setError(getApiErrorMessage(data, `Request failed (${res.status})`))
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
		<section>
			<form onSubmit={onSubmit} className="card card-pad form-grid">
				<div className="form-grid form-grid-two">
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

					<label className="field">
					Location (optional)
					<input
						type="text"
						value={location}
						onChange={(e) => setLocation(e.target.value)}
						placeholder="Site - Floor 1"
					/>
				</label>
				</div>

				<button
					type="submit"
					disabled={loading}
					className="button"
				>
					{loading ? 'Checking...' : 'Check Availability'}
				</button>

				{error ? <p className="alert alert-error">{error}</p> : null}
			</form>

			{searched && !error ? <AvailabilityResults lockers={results} /> : null}
		</section>
	)
}
