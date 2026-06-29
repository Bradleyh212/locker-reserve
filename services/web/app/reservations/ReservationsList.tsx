'use client'

import { useState } from 'react'
import { apiUrl, authFetch } from '../lib/auth'
import {
	formatDateTime,
	getApiErrorMessage,
	getDisplayReservationStatus,
	getReservationStatusClass,
} from '../lib/ui'
import PayReservationButton from './PayReservationButton'

type Reservation = {
	id: string
	lockerId: string
	status: string
	startTime: string
	endTime: string
	expiresAt: string
	createdAt: string
	locker: {
		code: string
	}
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
			const res = await authFetch(apiUrl(`/reservations/${id}/confirm`), {
				method: 'PATCH',
			})

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				setError(getApiErrorMessage(data, `Request failed (${res.status})`))
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
		if (!window.confirm('Cancel this reservation?')) {
			return
		}

		setError(null)
		setLoadingId(id)

		try {
			const res = await authFetch(apiUrl(`/reservations/${id}/cancel`), {
				method: 'PATCH',
			})

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				setError(getApiErrorMessage(data, `Request failed (${res.status})`))
				return
			}

			onChanged()
		} catch (e: any) {
			setError(e?.message ?? 'Network error')
		} finally {
			setLoadingId(null)
		}
	}

	return (
		<section>
			<h2 className="section-title">Reservation list</h2>

			{error ? <p className="alert alert-error">{error}</p> : null}

			{reservations.length === 0 ? (
				<p className="empty-state">No reservations match the current filters.</p>
			) : (
				<div className="table-wrap">
					<table className="table">
						<thead>
							<tr>
								<th>Locker</th>
								<th>Status</th>
								<th>Reservation window</th>
								<th>Hold expires</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{reservations.map((reservation) => {
								const expiresAt = new Date(reservation.expiresAt)
								const displayStatus =
									getDisplayReservationStatus(reservation)
								const activeHold =
									reservation.status === 'HOLD' && expiresAt > new Date()
								const canConfirm = activeHold
								const canCancel =
									activeHold || reservation.status === 'CONFIRMED'
								const canPay = activeHold

								return (
									<tr key={reservation.id}>
										<td>
											<strong>{reservation.locker.code}</strong>
										</td>
										<td>
											<span className={getReservationStatusClass(displayStatus)}>
												{displayStatus}
											</span>
										</td>
										<td>
											{formatDateTime(reservation.startTime)}
											<br />
											<span className="metric-note">
												to {formatDateTime(reservation.endTime)}
											</span>
										</td>
										<td>{formatDateTime(reservation.expiresAt)}</td>
										<td>
											<div className="button-row">
												{canConfirm ? (
													<button
														onClick={() => confirmReservation(reservation.id)}
														disabled={loadingId === reservation.id}
														className="button button-secondary"
													>
														{loadingId === reservation.id
															? 'Confirming...'
															: 'Confirm'}
													</button>
												) : null}

												{canCancel ? (
													<button
														onClick={() => cancelReservation(reservation.id)}
														disabled={loadingId === reservation.id}
														className="button button-danger"
													>
														{loadingId === reservation.id
															? 'Cancelling...'
															: 'Cancel'}
													</button>
												) : null}

												{canPay ? (
													<PayReservationButton
														reservationId={reservation.id}
														onChanged={onChanged}
													/>
												) : null}
											</div>
										</td>
									</tr>
								)
							})}
						</tbody>
					</table>
				</div>
			)}
		</section>
	)
}
