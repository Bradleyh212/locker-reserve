'use client'

import { useCallback, useEffect, useState } from 'react'
import RequireAdminAuth from '../components/RequireAdminAuth'
import { apiUrl, authFetch } from '../lib/auth'
import CreateHoldForm from './CreateHoldForm'
import ReservationsList from './ReservationsList'

type Reservation = {
	id: string
	lockerId: string
	status: string
	startTime: string
	endTime: string
	expiresAt: string
	locker: {
		code: string
	}
}

type Locker = {
	id: string
	code: string
	location: string
	isActive: boolean
}

export default function ReservationsPage() {
	return (
		<RequireAdminAuth>
			<ReservationsAdmin />
		</RequireAdminAuth>
	)
}

function ReservationsAdmin() {
	const [reservations, setReservations] = useState<Reservation[]>([])
	const [lockers, setLockers] = useState<Locker[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	const loadReservationsPage = useCallback(async () => {
		setError(null)
		setLoading(true)

		try {
			const [reservationsRes, lockersRes] = await Promise.all([
				authFetch(apiUrl('/reservations'), { cache: 'no-store' }),
				authFetch(apiUrl('/lockers'), { cache: 'no-store' }),
			])

			const reservationsData = await reservationsRes.json().catch(() => null)
			const lockersData = await lockersRes.json().catch(() => null)

			if (!reservationsRes.ok) {
				setError(
					reservationsData?.message ??
						`Reservations request failed (${reservationsRes.status})`,
				)
				return
			}

			if (!lockersRes.ok) {
				setError(
					lockersData?.message ?? `Lockers request failed (${lockersRes.status})`,
				)
				return
			}

			setReservations(reservationsData)
			setLockers(lockersData)
		} catch (e: any) {
			setError(e?.message ?? 'Network error')
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		loadReservationsPage()
	}, [loadReservationsPage])

	return (
		<main style={{ padding: 24, maxWidth: 720 }}>
			<h1>Reservations</h1>

			<CreateHoldForm lockers={lockers} onChanged={loadReservationsPage} />

			<hr style={{ margin: '24px 0' }} />

			{loading ? <p>Loading reservations...</p> : null}
			{error ? <p style={{ color: 'crimson' }}>{error}</p> : null}
			{!loading && !error ? (
				<ReservationsList
					reservations={reservations}
					onChanged={loadReservationsPage}
				/>
			) : null}
		</main>
	)
}
