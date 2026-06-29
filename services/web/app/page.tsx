'use client'

import type { CSSProperties } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import RequireAdminAuth from './components/RequireAdminAuth'
import { apiUrl, authFetch } from './lib/auth'
import {
	formatDateTime,
	getDisplayReservationStatus,
	getReservationStatusClass,
} from './lib/ui'

type DailyReservation = {
	date: string
	count: number
}

type StatusBreakdown = {
	status: string
	count: number
}

type RecentReservation = {
	id: string
	lockerCode: string
	startTime: string
	endTime: string
	expiresAt: string
	status: string
	createdAt: string
	estimatedTotalCents: number
	paymentStatus: string
}

type DashboardStats = {
	totalLockers: number
	activeLockers: number
	inactiveLockers: number
	activeReservations: number
	pendingHolds: number
	confirmedReservations: number
	expiredReservations: number
	cancelledReservations: number
	dailyReservations: DailyReservation[]
	statusBreakdown: StatusBreakdown[]
	recentReservations: RecentReservation[]
}

type MetricCard = {
	label: string
	value: number
	note: string
	icon: string
	color: string
	soft: string
	toneClass?: string
	data: number[]
}

const statusColors: Record<string, string> = {
	CONFIRMED: '#1f6fff',
	HOLD: '#20b66d',
	EXPIRED: '#ff8a1f',
	CANCELLED: '#ef4444',
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

	const reservationTrend = useMemo(
		() => stats?.dailyReservations.map((point) => point.count) ?? [],
		[stats],
	)

	const metricCards: MetricCard[] = stats
		? [
				{
					label: 'Total Lockers',
					value: stats.totalLockers,
					note: `${stats.inactiveLockers} inactive`,
					icon: 'LR',
					color: '#5b2cf0',
					soft: '#efeaff',
					data: smoothData(stats.totalLockers, reservationTrend),
				},
				{
					label: 'Active Lockers',
					value: stats.activeLockers,
					note:
						stats.totalLockers > 0
							? `${Math.round(
									(stats.activeLockers / stats.totalLockers) * 100,
								)}% of total`
							: 'No lockers yet',
					icon: 'AL',
					color: '#20b66d',
					soft: '#e8f8ef',
					toneClass: 'metric-positive',
					data: smoothData(stats.activeLockers, reservationTrend),
				},
				{
					label: 'Active Reservations',
					value: stats.activeReservations,
					note: 'Holds and confirmed',
					icon: 'AR',
					color: '#1f6fff',
					soft: '#e8f1ff',
					toneClass: 'metric-positive',
					data: reservationTrend,
				},
				{
					label: 'Pending Holds',
					value: stats.pendingHolds,
					note: 'Expiring soon',
					icon: 'PH',
					color: '#ff8a1f',
					soft: '#fff1e3',
					toneClass: 'metric-warning',
					data: smoothData(stats.pendingHolds, reservationTrend),
				},
				{
					label: 'Confirmed Reservations',
					value: stats.confirmedReservations,
					note: 'Paid or manually confirmed',
					icon: 'CR',
					color: '#1f6fff',
					soft: '#e8f1ff',
					toneClass: 'metric-positive',
					data: smoothData(stats.confirmedReservations, reservationTrend),
				},
				{
					label: 'Cancelled Reservations',
					value: stats.cancelledReservations,
					note: `${stats.expiredReservations} expired`,
					icon: 'CX',
					color: '#ef4444',
					soft: '#ffe9e9',
					toneClass: 'metric-negative',
					data: smoothData(stats.cancelledReservations, reservationTrend),
				},
			]
		: []

	return (
		<main className="page dashboard-page">
			<section className="page-header">
				<div>
					<h1 className="page-title">Dashboard</h1>
					<p className="lede">Overview of your locker reservation system</p>
				</div>
				<div className="date-pill">
					<span>Last 30 days</span>
					<button className="button button-secondary" onClick={loadStats}>
						Refresh
					</button>
				</div>
			</section>

			{loading ? <p className="loading-state">Loading dashboard stats...</p> : null}
			{error ? <p className="alert alert-error">{error}</p> : null}

			{stats ? (
				<>
					<section className="dashboard-metric-grid">
						{metricCards.map((card) => (
							<MetricCardView key={card.label} card={card} />
						))}
					</section>

					<section className="dashboard-chart-grid">
						<article className="card chart-card">
							<div className="chart-header">
								<h2 className="section-title">Reservations Over Time</h2>
								<span className="badge badge-info">Last 30 days</span>
							</div>
							<LineChart data={stats.dailyReservations} color="#5b2cf0" />
						</article>

						<article className="card chart-card">
							<h2 className="section-title">Reservations by Status</h2>
							<DonutChart data={stats.statusBreakdown} />
						</article>
					</section>

					<RecentReservationsTable reservations={stats.recentReservations} />
				</>
			) : null}
		</main>
	)
}

function MetricCardView({ card }: { card: MetricCard }) {
	return (
		<article
			className="card stat-card"
			style={
				{
					'--card-color': card.color,
					'--card-soft': card.soft,
				} as CSSProperties
			}
		>
			<div className="stat-topline">
				<span className="stat-icon">{card.icon}</span>
				<p className="stat-label">{card.label}</p>
			</div>
			<p className="stat-value">{card.value}</p>
			<p className={`metric-note ${card.toneClass ?? ''}`}>{card.note}</p>
			<Sparkline data={card.data} color={card.color} />
		</article>
	)
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
	const points = getChartPoints(data.length ? data : [0], 120, 34, 3)

	return (
		<svg className="sparkline" viewBox="0 0 120 34" aria-hidden="true">
			<polyline
				fill="none"
				points={points}
				stroke={color}
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="3"
			/>
		</svg>
	)
}

function LineChart({
	data,
	color,
}: {
	data: DailyReservation[]
	color: string
}) {
	const width = 760
	const height = 245
	const padding = 34
	const values = data.map((point) => point.count)
	const maxValue = Math.max(4, ...values)
	const points = data
		.map((point, index) => {
			const x =
				padding +
				(data.length <= 1
					? 0
					: (index / (data.length - 1)) * (width - padding * 1.5))
			const y =
				height -
				padding -
				(point.count / maxValue) * (height - padding * 1.8)

			return `${x},${y}`
		})
		.join(' ')
	const xLabels = [0, 7, 14, 21, 29]
		.filter((index) => data[index])
		.map((index) => data[index])

	return (
		<svg className="line-chart" viewBox={`0 0 ${width} ${height}`} role="img">
			<title>Reservations created during the last 30 days</title>
			{[0, 1, 2, 3, 4].map((line) => {
				const y = padding + line * ((height - padding * 1.5) / 4)

				return (
					<line
						key={line}
						x1={padding}
						x2={width - padding / 2}
						y1={y}
						y2={y}
						stroke="#e9edf5"
						strokeWidth="1"
					/>
				)
			})}
			<polyline
				fill="none"
				points={points}
				stroke={color}
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="4"
			/>
			{points.split(' ').map((point, index) => {
				if (index % 3 !== 0 && index !== points.split(' ').length - 1) {
					return null
				}

				const [x, y] = point.split(',').map(Number)
				return (
					<circle
						key={point}
						cx={x}
						cy={y}
						r="4"
						fill="#fff"
						stroke={color}
						strokeWidth="3"
					/>
				)
			})}
			{xLabels.map((point, index) => {
				const x =
					padding +
					(data.length <= 1
						? 0
						: ((index * 7) / (data.length - 1)) *
							(width - padding * 1.5))

				return (
					<text
						key={point.date}
						x={x}
						y={height - 8}
						fill="#60708a"
						fontSize="12"
						textAnchor={index === 0 ? 'start' : 'middle'}
					>
						{formatChartDate(point.date)}
					</text>
				)
			})}
		</svg>
	)
}

function DonutChart({ data }: { data: StatusBreakdown[] }) {
	const total = data.reduce((sum, item) => sum + item.count, 0)
	let offset = 0

	return (
		<div className="donut-layout">
			<svg className="donut-chart" viewBox="0 0 220 220" role="img">
				<title>Reservation status distribution</title>
				<circle
					cx="110"
					cy="110"
					fill="none"
					r="74"
					stroke="#eef2f7"
					strokeWidth="34"
				/>
				{data.map((item) => {
					const percentage = total > 0 ? (item.count / total) * 100 : 0
					const currentOffset = offset
					offset += percentage

					return (
						<circle
							key={item.status}
							cx="110"
							cy="110"
							fill="none"
							pathLength="100"
							r="74"
							stroke={statusColors[item.status] ?? '#60708a'}
							strokeDasharray={`${percentage} ${100 - percentage}`}
							strokeDashoffset={-currentOffset}
							strokeLinecap="butt"
							strokeWidth="34"
							transform="rotate(-90 110 110)"
						/>
					)
				})}
				<text
					x="110"
					y="106"
					fill="#07122b"
					fontSize="28"
					fontWeight="900"
					textAnchor="middle"
				>
					{total}
				</text>
				<text
					x="110"
					y="130"
					fill="#60708a"
					fontSize="14"
					textAnchor="middle"
				>
					Total
				</text>
			</svg>
			<div className="donut-legend">
				{data.map((item) => {
					const percentage = total > 0 ? (item.count / total) * 100 : 0

					return (
						<div className="legend-row" key={item.status}>
							<span
								className="legend-dot"
								style={{
									background: statusColors[item.status] ?? '#60708a',
								}}
							/>
							<span>{getStatusLabel(item.status)}</span>
							<strong>
								{item.count} ({percentage.toFixed(1)}%)
							</strong>
						</div>
					)
				})}
			</div>
		</div>
	)
}

function RecentReservationsTable({
	reservations,
}: {
	reservations: RecentReservation[]
}) {
	return (
		<section className="card recent-card">
			<div className="recent-card-header">
				<h2 className="section-title" style={{ margin: 0 }}>
					Recent Reservations
				</h2>
				<Link href="/reservations" className="button button-secondary">
					View all
				</Link>
			</div>
			{reservations.length === 0 ? (
				<p className="empty-state" style={{ margin: 20 }}>
					No reservations yet.
				</p>
			) : (
				<div className="table-wrap" style={{ border: 0, borderRadius: 0 }}>
					<table className="table">
						<thead>
							<tr>
								<th>ID</th>
								<th>Locker</th>
								<th>User</th>
								<th>Start Date</th>
								<th>End Date</th>
								<th>Status</th>
								<th>Total</th>
								<th>Payment</th>
								<th>Created At</th>
							</tr>
						</thead>
						<tbody>
							{reservations.map((reservation) => {
								const displayStatus = getDisplayReservationStatus(reservation)

								return (
									<tr key={reservation.id}>
										<td>{formatReservationId(reservation.id)}</td>
										<td>
											<strong>{reservation.lockerCode}</strong>
										</td>
										<td>Guest</td>
										<td>{formatDateTime(reservation.startTime)}</td>
										<td>{formatDateTime(reservation.endTime)}</td>
										<td>
											<span className={getReservationStatusClass(displayStatus)}>
												{getStatusLabel(displayStatus)}
											</span>
										</td>
										<td>{formatCurrency(reservation.estimatedTotalCents)}</td>
										<td>
											<span className={getPaymentBadgeClass(reservation.paymentStatus)}>
												{reservation.paymentStatus}
											</span>
										</td>
										<td>{formatDateTime(reservation.createdAt)}</td>
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

function smoothData(value: number, trend: number[]) {
	const source = trend.length ? trend : [value]
	const base = Math.max(0, value)

	return source.map((point, index) =>
		Math.max(0, Math.round(base + point - source[0] + Math.sin(index) * 2)),
	)
}

function getChartPoints(
	data: number[],
	width: number,
	height: number,
	padding: number,
) {
	const max = Math.max(...data, 1)
	const min = Math.min(...data)
	const spread = Math.max(max - min, 1)

	return data
		.map((value, index) => {
			const x =
				padding +
				(data.length <= 1
					? 0
					: (index / (data.length - 1)) * (width - padding * 2))
			const y =
				height -
				padding -
				((value - min) / spread) * (height - padding * 2)

			return `${x},${y}`
		})
		.join(' ')
}

function formatChartDate(value: string) {
	return new Date(`${value}T00:00:00`).toLocaleDateString([], {
		month: 'short',
		day: 'numeric',
	})
}

function formatCurrency(cents: number) {
	return new Intl.NumberFormat('en-CA', {
		style: 'currency',
		currency: 'CAD',
	}).format(cents / 100)
}

function formatReservationId(id: string) {
	return `RES-${id.slice(0, 4).toUpperCase()}`
}

function getStatusLabel(status: string) {
	switch (status) {
		case 'HOLD':
			return 'Pending'
		case 'CONFIRMED':
			return 'Confirmed'
		case 'CANCELLED':
			return 'Cancelled'
		case 'EXPIRED':
			return 'Expired'
		default:
			return status
	}
}

function getPaymentBadgeClass(status: string) {
	switch (status) {
		case 'Paid':
			return 'badge badge-success'
		case 'Pending':
			return 'badge badge-info'
		case 'Closed':
			return 'badge badge-muted'
		case 'Expired':
		default:
			return 'badge badge-warning'
	}
}
