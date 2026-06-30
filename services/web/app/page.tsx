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
	icon: MetricIconName
	color: string
	soft: string
	toneClass?: string
	data: number[]
}

type MetricIconName =
	| 'lockers'
	| 'activeLockers'
	| 'reservations'
	| 'holds'
	| 'confirmed'
	| 'cancelled'

const statusColors: Record<string, string> = {
	CONFIRMED: 'var(--chart-blue)',
	HOLD: 'var(--chart-orange)',
	EXPIRED: 'var(--chart-violet)',
	CANCELLED: 'var(--chart-red)',
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
					icon: 'lockers',
					color: 'var(--metric-purple)',
					soft: 'var(--metric-purple-soft)',
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
					icon: 'activeLockers',
					color: 'var(--metric-green)',
					soft: 'var(--metric-green-soft)',
					toneClass: 'metric-positive',
					data: smoothData(stats.activeLockers, reservationTrend),
				},
				{
					label: 'Active Reservations',
					value: stats.activeReservations,
					note: 'Holds and confirmed',
					icon: 'reservations',
					color: 'var(--metric-blue)',
					soft: 'var(--metric-blue-soft)',
					toneClass: 'metric-positive',
					data: reservationTrend,
				},
				{
					label: 'Pending Holds',
					value: stats.pendingHolds,
					note: 'Expiring soon',
					icon: 'holds',
					color: 'var(--metric-orange)',
					soft: 'var(--metric-orange-soft)',
					toneClass: 'metric-warning',
					data: smoothData(stats.pendingHolds, reservationTrend),
				},
				{
					label: 'Confirmed Reservations',
					value: stats.confirmedReservations,
					note: 'Paid or manually confirmed',
					icon: 'confirmed',
					color: 'var(--metric-blue)',
					soft: 'var(--metric-blue-soft)',
					toneClass: 'metric-positive',
					data: smoothData(stats.confirmedReservations, reservationTrend),
				},
				{
					label: 'Cancelled Reservations',
					value: stats.cancelledReservations,
					note: `${stats.expiredReservations} expired`,
					icon: 'cancelled',
					color: 'var(--metric-red)',
					soft: 'var(--metric-red-soft)',
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
							<LineChart
								data={stats.dailyReservations}
								color="var(--chart-purple)"
							/>
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
				<p className="stat-label">{card.label}</p>
				<span className="stat-icon" aria-hidden="true">
					<MetricIcon icon={card.icon} />
				</span>
			</div>
			<p className="stat-value">{card.value}</p>
			<p className={`metric-note ${card.toneClass ?? ''}`}>{card.note}</p>
			<Sparkline data={card.data} color={card.color} />
		</article>
	)
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
	const points = getChartPoints(data.length ? data : [0], 120, 24, 3)

	return (
		<svg className="sparkline" viewBox="0 0 120 24" aria-hidden="true">
			<polyline
				fill="none"
				points={points}
				stroke={color}
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="2.2"
			/>
		</svg>
	)
}

function MetricIcon({ icon }: { icon: MetricIconName }) {
	switch (icon) {
		case 'activeLockers':
			return (
				<svg viewBox="0 0 24 24" fill="none">
					<path d="M5 5h14v14H5z" stroke="currentColor" strokeWidth="1.8" />
					<path d="M12 5v14M8.5 9H10M8.5 13H10M14.5 9H16M14.5 13H16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
				</svg>
			)
		case 'reservations':
			return (
				<svg viewBox="0 0 24 24" fill="none">
					<rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.8" />
					<path d="M8 3.5v3M16 3.5v3M4 10h16M8 15h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
				</svg>
			)
		case 'holds':
			return (
				<svg viewBox="0 0 24 24" fill="none">
					<circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
					<path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			)
		case 'confirmed':
			return (
				<svg viewBox="0 0 24 24" fill="none">
					<circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
					<path d="m8.5 12.3 2.2 2.2 4.8-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			)
		case 'cancelled':
			return (
				<svg viewBox="0 0 24 24" fill="none">
					<circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
					<path d="m9 9 6 6M15 9l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
				</svg>
			)
		case 'lockers':
		default:
			return (
				<svg viewBox="0 0 24 24" fill="none">
					<rect x="5" y="4" width="14" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
					<path d="M12 4v16M8.5 8h1.5M8.5 12h1.5M14.5 8H16M14.5 12H16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
				</svg>
			)
	}
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
						stroke="var(--chart-grid)"
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
						fill="var(--chart-center)"
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
						fill="var(--chart-label)"
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
	const chartData = [...data].sort(
		(a, b) => getStatusSortValue(a.status) - getStatusSortValue(b.status),
	)
	const total = chartData.reduce((sum, item) => sum + item.count, 0)
	const center = 110
	const outerRadius = 82
	const innerRadius = 52
	const activeStatusCount = chartData.filter((item) => item.count > 0).length
	const donutSegments = chartData.reduce<{
		startAngle: number
		segments: Array<{
			color: string
			path: string
			status: string
		}>
	}>(
		(acc, item) => {
			if (total === 0 || item.count === 0) {
				return acc
			}

			const sweep = (item.count / total) * 360
			const endAngle = acc.startAngle + sweep
			const gap = activeStatusCount > 1 && sweep > 4 ? 1.6 : 0
			const path = describeDonutSegment(
				center,
				center,
				outerRadius,
				innerRadius,
				acc.startAngle + gap / 2,
				endAngle - gap / 2,
			)

			return {
				startAngle: endAngle,
				segments: [
					...acc.segments,
					{
						color: statusColors[item.status] ?? 'var(--chart-label)',
						path,
						status: item.status,
					},
				],
			}
		},
		{ startAngle: 0, segments: [] },
	).segments

	return (
		<div className="donut-layout">
			<svg className="donut-chart" viewBox="0 0 220 220" role="img">
				<title>Reservation status distribution</title>
				<circle
					cx={center}
					cy={center}
					fill="var(--chart-ring)"
					r={outerRadius}
				/>
				<circle
					cx={center}
					cy={center}
					fill="var(--chart-center)"
					r={innerRadius}
				/>
				{donutSegments.map((segment) => {
					return (
						<path
							key={segment.status}
							d={segment.path}
							fill={segment.color}
						/>
					)
				})}
				<text
					x="110"
					y="106"
					fill="var(--chart-title)"
					fontSize="28"
					fontWeight="900"
					textAnchor="middle"
				>
					{total}
				</text>
				<text
					x="110"
					y="130"
					fill="var(--chart-label)"
					fontSize="14"
					textAnchor="middle"
				>
					Total
				</text>
			</svg>
			<div className="donut-legend">
				{chartData.map((item) => {
					const percentage = total > 0 ? (item.count / total) * 100 : 0

					return (
						<div className="legend-row" key={item.status}>
							<span
								className="legend-dot"
								style={{
									background:
										statusColors[item.status] ?? 'var(--chart-label)',
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

function getStatusSortValue(status: string) {
	switch (status) {
		case 'CONFIRMED':
			return 1
		case 'HOLD':
			return 2
		case 'EXPIRED':
			return 3
		case 'CANCELLED':
			return 4
		default:
			return 99
	}
}

function describeDonutSegment(
	cx: number,
	cy: number,
	outerRadius: number,
	innerRadius: number,
	startAngle: number,
	endAngle: number,
) {
	const cappedEndAngle =
		endAngle - startAngle >= 360 ? startAngle + 359.99 : endAngle
	const outerStart = polarToCartesian(cx, cy, outerRadius, startAngle)
	const outerEnd = polarToCartesian(cx, cy, outerRadius, cappedEndAngle)
	const innerEnd = polarToCartesian(cx, cy, innerRadius, cappedEndAngle)
	const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle)
	const largeArcFlag = cappedEndAngle - startAngle > 180 ? 1 : 0

	return [
		`M ${outerStart.x} ${outerStart.y}`,
		`A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${outerEnd.x} ${outerEnd.y}`,
		`L ${innerEnd.x} ${innerEnd.y}`,
		`A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${innerStart.x} ${innerStart.y}`,
		'Z',
	].join(' ')
}

function polarToCartesian(
	cx: number,
	cy: number,
	radius: number,
	angle: number,
) {
	const radians = ((angle - 90) * Math.PI) / 180

	return {
		x: Number((cx + radius * Math.cos(radians)).toFixed(3)),
		y: Number((cy + radius * Math.sin(radians)).toFixed(3)),
	}
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
