'use client'

import { useState } from 'react'
import { apiUrl, authFetch } from '../lib/auth'
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

const statusStyles: Record<
	string,
	{ backgroundColor: string; borderColor: string; color: string }
> = {
	HOLD: {
		backgroundColor: '#2f2813',
		borderColor: '#c9941a',
		color: '#ffe2a3',
	},
	CONFIRMED: {
		backgroundColor: '#102a1b',
		borderColor: '#2f9e60',
		color: '#a7f3c2',
	},
	CANCELLED: {
		backgroundColor: '#2d1820',
		borderColor: '#b84d67',
		color: '#ffc2d0',
	},
	EXPIRED: {
		backgroundColor: '#2b1f16',
		borderColor: '#b56a2c',
		color: '#ffd0a3',
	},
}

function getStatusStyle(status: string) {
	return (
		statusStyles[status] ?? {
			backgroundColor: '#1f1f1f',
			borderColor: '#555',
			color: 'white',
		}
	)
}

export default function ReservationsList({
	reservations,
	onChanged,
}: {
	reservations: Reservation[]
	onChanged: () => void
}) {
	const [loadingId, setLoadingId] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	async function confirmReservation(id: string) {
		setError(null)
		setLoadingId(id)

		try {
			const res = await authFetch(
				apiUrl(`/reservations/${id}/confirm`),
				{
					method: 'PATCH',
				},
			)

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				setError(data?.message ?? `Request failed (${res.status})`)
				return
			}

			onChanged()
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
			const res = await authFetch(
				apiUrl(`/reservations/${id}/cancel`),
				{
					method: 'PATCH',
				},
			)

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				setError(data?.message ?? `Request failed (${res.status})`)
				return
			}

			onChanged()
		} catch (e: any) {
			setError(e?.message ?? 'Network error')
		} finally {
			setLoadingId(null)
		}
	}

	function getDisplayStatus(r: Reservation, now: Date) {
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
					const now = new Date()
					const expiresAt = new Date(r.expiresAt)
					const displayStatus = getDisplayStatus(r, now)
					const statusStyle = getStatusStyle(displayStatus)
					const activeHold = r.status === 'HOLD' && expiresAt > now
					const canConfirm = activeHold
					const canCancel =
						activeHold || r.status === 'CONFIRMED'
					const canPay = activeHold

					return (
						<li key={r.id} style={{ marginBottom: 14 }}>
							<b>{r.locker.code}</b>{' '}
							<span
								style={{
									display: 'inline-block',
									marginLeft: 8,
									padding: '2px 8px',
									border: `1px solid ${statusStyle.borderColor}`,
									borderRadius: 999,
									backgroundColor: statusStyle.backgroundColor,
									color: statusStyle.color,
									fontSize: '0.75rem',
									fontWeight: 700,
									lineHeight: 1.6,
								}}
							>
								{displayStatus}
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

							{canPay ? (
								<PayReservationButton
									reservationId={r.id}
									onChanged={onChanged}
								/>
							) : null}
						</li>
					)
				})}
			</ul>
		</section>
	)
}
