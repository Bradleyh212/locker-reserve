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
		<main className="page">
			<section className="page-header">
				<div>
					<p className="eyebrow">Inventory</p>
					<h1 className="page-title">Lockers</h1>
					<p className="lede">
						Manage locker inventory and control which lockers are available
						for reservations.
					</p>
				</div>
			</section>

			<CreateLockerForm onChanged={loadLockers} />

			<div style={{ height: 24 }} />

			{loading ? <p className="loading-state">Loading lockers...</p> : null}
			{error ? <p className="alert alert-error">{error}</p> : null}
			{!loading && !error ? (
				<LockersList lockers={lockers} onChanged={loadLockers} />
			) : null}
		</main>
	)
}
