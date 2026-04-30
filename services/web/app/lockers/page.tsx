'use client'

import { useCallback, useEffect, useState } from 'react'
import RequireAdminAuth from '../components/RequireAdminAuth'
import { apiUrl, authFetch } from '../lib/auth'
import CreateLockerForm from './CreateLockerForm'
import LockersList from './LockersList'

type Locker = {
	id: string
	code: string
	location: string
	isActive: boolean
	createdAt: string
	updatedAt: string
}

export default function LockersPage() {
	return (
		<RequireAdminAuth>
			<LockersAdmin />
		</RequireAdminAuth>
	)
}

function LockersAdmin() {
	const [lockers, setLockers] = useState<Locker[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	const loadLockers = useCallback(async () => {
		setError(null)
		setLoading(true)

		try {
			const res = await authFetch(apiUrl('/lockers'), { cache: 'no-store' })
			const data = await res.json().catch(() => null)

			if (!res.ok) {
				setError(data?.message ?? `Request failed (${res.status})`)
				return
			}

			setLockers(data)
		} catch (e: any) {
			setError(e?.message ?? 'Network error')
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		loadLockers()
	}, [loadLockers])

	return (
		<main style={{ padding: 24, maxWidth: 720 }}>
			<h1>Lockers</h1>

			<CreateLockerForm onChanged={loadLockers} />

			<hr style={{ margin: '24px 0' }} />

			{loading ? <p>Loading lockers...</p> : null}
			{error ? <p style={{ color: 'crimson' }}>{error}</p> : null}
			{!loading && !error ? (
				<LockersList lockers={lockers} onChanged={loadLockers} />
			) : null}
		</main>
	)
}
