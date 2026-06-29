'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import RequireAdminAuth from './components/RequireAdminAuth'
import { apiUrl, authFetch } from './lib/auth'

type DashboardStats = {
	totalLockers: number
	activeLockers: number
	inactiveLockers: number
	activeReservations: number
	pendingHolds: number
	confirmedReservations: number
	expiredReservations: number
	cancelledReservations: number
}

export default function HomePage() {
	return (
		<RequireAdminAuth>
			<Dashboard />
		</RequireAdminAuth>
	)
}

function Dashboard() {
	const [stats, setStats] = useState<DashboardStats | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	const loadStats = useCallback(async () => {
		setError(null)
		setLoading(true)

		try {
			const res = await authFetch(apiUrl('/dashboard/stats'), {
				cache: 'no-store',
			})
			const data = await res.json().catch(() => null)

			if (!res.ok) {
				setError(data?.message ?? `Stats request failed (${res.status})`)
				return
			}

			setStats(data)
		} catch (e: any) {
			setError(e?.message ?? 'Network error')
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		loadStats()
	}, [loadStats])

	const statCards: Array<[string, number, string]> = stats
		? [
				['Total lockers', stats.totalLockers, 'All lockers in inventory'],
				['Active lockers', stats.activeLockers, 'Available for booking'],
				['Inactive lockers', stats.inactiveLockers, 'Hidden from booking'],
				['Active reservations', stats.activeReservations, 'Holds and confirmed'],
				['Pending holds', stats.pendingHolds, 'Awaiting payment or confirmation'],
				['Confirmed', stats.confirmedReservations, 'Booked reservations'],
				['Expired', stats.expiredReservations, 'Expired holds'],
				['Cancelled', stats.cancelledReservations, 'Cancelled reservations'],
			]
		: []

	const actionCards = [
		{
			title: 'Manage lockers',
			description: 'Create lockers, change locations, and control active status.',
			href: '/lockers',
		},
		{
			title: 'Review reservations',
			description: 'Filter holds, confirmations, cancellations, and expired bookings.',
			href: '/reservations',
		},
		{
			title: 'Check availability',
			description: 'Search available lockers for a location and time range.',
			href: '/availability',
		},
		{
			title: 'Public booking',
			description: 'Open the user-facing booking and payment flow.',
			href: '/book',
		},
	]

	return (
		<main className="page">
			<section className="page-header">
				<div>
					<p className="eyebrow">Admin overview</p>
					<h1 className="page-title">Locker Reserve Dashboard</h1>
					<p className="lede">
						Monitor locker capacity, reservation activity, and core admin
						workflows from one place.
					</p>
				</div>
				<button className="button button-secondary" onClick={loadStats}>
					Refresh
				</button>
			</section>

			{loading ? <p className="loading-state">Loading dashboard stats...</p> : null}
			{error ? <p className="alert alert-error">{error}</p> : null}

			{stats ? (
				<section className="grid stats-grid" style={{ marginBottom: 28 }}>
					{statCards.map(([label, value, note]) => (
						<article className="card stat-card" key={label}>
							<p className="stat-label">{label}</p>
							<p className="stat-value">{value}</p>
							<p className="metric-note">{note}</p>
						</article>
					))}
				</section>
			) : null}

			<section>
				<h2 className="section-title">Workflows</h2>
				<div className="grid action-grid">
					{actionCards.map((card) => (
						<Link key={card.href} href={card.href} className="card card-pad">
							<h3 style={{ margin: '0 0 8px' }}>{card.title}</h3>
							<p className="metric-note">{card.description}</p>
						</Link>
					))}
				</div>
			</section>
		</main>
	)
}
