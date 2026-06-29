'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import RequireAdminAuth from '../components/RequireAdminAuth'
import { apiUrl, authFetch } from '../lib/auth'
import { getDisplayReservationStatus } from '../lib/ui'
import CreateHoldForm from './CreateHoldForm'
import ReservationsList from './ReservationsList'

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
	const [statusFilter, setStatusFilter] = useState('ALL')
	const [lockerFilter, setLockerFilter] = useState('ALL')
	const [startDate, setStartDate] = useState('')
	const [endDate, setEndDate] = useState('')
	const [sortBy, setSortBy] = useState('newest')

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

	const visibleReservations = useMemo(() => {
		const startBoundary = startDate ? new Date(`${startDate}T00:00:00`) : null
		const endBoundary = endDate ? new Date(`${endDate}T23:59:59`) : null

		return reservations
			.filter((reservation) => {
				const displayStatus = getDisplayReservationStatus(reservation)
				const startsAt = new Date(reservation.startTime)
				const endsAt = new Date(reservation.endTime)

				if (statusFilter !== 'ALL' && displayStatus !== statusFilter) {
					return false
				}

				if (lockerFilter !== 'ALL' && reservation.lockerId !== lockerFilter) {
					return false
				}

				if (startBoundary && startsAt < startBoundary) {
					return false
				}

				if (endBoundary && endsAt > endBoundary) {
					return false
				}

				return true
			})
			.sort((a, b) => {
				switch (sortBy) {
					case 'oldest':
						return (
							new Date(a.createdAt).getTime() -
							new Date(b.createdAt).getTime()
						)
					case 'start':
						return (
							new Date(a.startTime).getTime() -
							new Date(b.startTime).getTime()
						)
					case 'status':
						return getDisplayReservationStatus(a).localeCompare(
							getDisplayReservationStatus(b),
						)
					case 'locker':
						return a.locker.code.localeCompare(b.locker.code)
					case 'newest':
					default:
						return (
							new Date(b.createdAt).getTime() -
							new Date(a.createdAt).getTime()
						)
				}
			})
	}, [endDate, lockerFilter, reservations, sortBy, startDate, statusFilter])

	function resetFilters() {
		setStatusFilter('ALL')
		setLockerFilter('ALL')
		setStartDate('')
		setEndDate('')
		setSortBy('newest')
	}

	return (
		<main className="page">
			<section className="page-header">
				<div>
					<p className="eyebrow">Bookings</p>
					<h1 className="page-title">Reservations</h1>
					<p className="lede">
						Create holds, review booking status, and narrow the reservation
						list by status, locker, and date range.
					</p>
				</div>
				<button
					type="button"
					className="button button-secondary"
					onClick={loadReservationsPage}
				>
					Refresh
				</button>
			</section>

			<CreateHoldForm lockers={lockers} onChanged={loadReservationsPage} />

			<section className="card card-pad" style={{ margin: '24px 0' }}>
				<h2 className="section-title">Filter reservations</h2>
				<div className="filters">
					<label className="field">
						Status
						<select
							value={statusFilter}
							onChange={(e) => setStatusFilter(e.target.value)}
						>
							<option value="ALL">All statuses</option>
							<option value="HOLD">Pending holds</option>
							<option value="CONFIRMED">Confirmed</option>
							<option value="EXPIRED">Expired</option>
							<option value="CANCELLED">Cancelled</option>
						</select>
					</label>

					<label className="field">
						Locker
						<select
							value={lockerFilter}
							onChange={(e) => setLockerFilter(e.target.value)}
						>
							<option value="ALL">All lockers</option>
							{lockers.map((locker) => (
								<option key={locker.id} value={locker.id}>
									{locker.code}
								</option>
							))}
						</select>
					</label>

					<label className="field">
						Starts after
						<input
							type="date"
							value={startDate}
							onChange={(e) => setStartDate(e.target.value)}
						/>
					</label>

					<label className="field">
						Ends before
						<input
							type="date"
							value={endDate}
							onChange={(e) => setEndDate(e.target.value)}
						/>
					</label>

					<label className="field">
						Sort
						<select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
							<option value="newest">Newest first</option>
							<option value="oldest">Oldest first</option>
							<option value="start">Reservation start date</option>
							<option value="status">Status</option>
							<option value="locker">Locker code</option>
						</select>
					</label>
				</div>
				<div className="button-row" style={{ marginTop: 14 }}>
					<button
						type="button"
						className="button button-secondary"
						onClick={resetFilters}
					>
						Reset filters
					</button>
					<p className="metric-note">
						Showing {visibleReservations.length} of {reservations.length}
					</p>
				</div>
			</section>

			{loading ? <p className="loading-state">Loading reservations...</p> : null}
			{error ? <p className="alert alert-error">{error}</p> : null}
			{!loading && !error ? (
				<ReservationsList
					reservations={visibleReservations}
					onChanged={loadReservationsPage}
				/>
			) : null}
		</main>
	)
}
