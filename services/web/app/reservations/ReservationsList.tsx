'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import PayReservationButton from './PayReservationButton'

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

export default function ReservationsList({
	reservations,
}: {
	reservations: Reservation[]
}) {
	const router = useRouter()
	const [loadingId, setLoadingId] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	async function confirmReservation(id: string) {
		setError(null)
		setLoadingId(id)

		try {
			const res = await fetch(
				`http://localhost:3001/reservations/${id}/confirm`,
				{
					method: 'PATCH',
				},
			)

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				setError(data?.message ?? `Request failed (${res.status})`)
				return
			}

			router.refresh()
		} catch (e: any) {
			setError(e?.message ?? 'Network error')
		} finally {
			setLoadingId(null)
		}
	}

	async function cancelReservation(id: string) {
		setError(null)
		setLoadingId(id)

		try {
			const res = await fetch(
				`http://localhost:3001/reservations/${id}/cancel`,
				{
					method: 'PATCH',
				},
			)

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				setError(data?.message ?? `Request failed (${res.status})`)
				return
			}

			router.refresh()
		} catch (e: any) {
			setError(e?.message ?? 'Network error')
		} finally {
			setLoadingId(null)
		}
	}

	function getDisplayStatus(r: Reservation) {
		const now = new Date()
		const expiresAt = new Date(r.expiresAt)

		if (r.status === 'HOLD' && expiresAt <= now) {
			return 'EXPIRED'
		}

		return r.status
	}

	return (
		<section style={{ marginTop: 16 }}>
			<h2>Reservations</h2>

			{error ? <p style={{ color: 'crimson' }}>{error}</p> : null}

			<ul style={{ paddingLeft: 18 }}>
				{reservations.map((r) => {
					const displayStatus = getDisplayStatus(r)
					const isExpired = displayStatus === 'EXPIRED'
					const canConfirm =
						r.status === 'HOLD' && new Date(r.expiresAt) > new Date()
					const canCancel =
						(r.status === 'HOLD' && new Date(r.expiresAt) > new Date()) ||
						r.status === 'CONFIRMED'
					const canPay =
						r.status === 'HOLD' && new Date(r.expiresAt) > new Date()

					return (
						<li key={r.id} style={{ marginBottom: 14 }}>
							<b>{r.locker.code}</b>{' '}
							<span style={{ color: isExpired ? 'crimson' : 'inherit' }}>
								— {displayStatus}
							</span>
							<br />
							{new Date(r.startTime).toLocaleString()} →{' '}
							{new Date(r.endTime).toLocaleString()}
							<br />
							<small>
								Hold expires: {new Date(r.expiresAt).toLocaleString()}
							</small>
							<br />

							{canConfirm ? (
								<button
									onClick={() => confirmReservation(r.id)}
									disabled={loadingId === r.id}
									style={{
										marginTop: 8,
										padding: '8px 14px',
										backgroundColor: '#1f1f1f',
										color: 'white',
										border: '1px solid #555',
										borderRadius: 6,
										cursor: loadingId === r.id ? 'not-allowed' : 'pointer',
										opacity: loadingId === r.id ? 0.7 : 1,
									}}
								>
									{loadingId === r.id ? 'Confirming...' : 'Confirm'}
								</button>
							) : null}

							{canCancel ? (
								<button
									onClick={() => cancelReservation(r.id)}
									disabled={loadingId === r.id}
									style={{
										marginTop: 8,
										marginLeft: 8,
										padding: '8px 14px',
										backgroundColor: '#3a1f1f',
										color: 'white',
										border: '1px solid #aa4444',
										borderRadius: 6,
										cursor: loadingId === r.id ? 'not-allowed' : 'pointer',
										opacity: loadingId === r.id ? 0.7 : 1,
									}}
								>
									{loadingId === r.id ? 'Cancelling...' : 'Cancel'}
								</button>
							) : null}

							{canPay ? <PayReservationButton reservationId={r.id} /> : null}
						</li>
					)
				})}
			</ul>
		</section>
	)
}