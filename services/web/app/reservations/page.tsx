import CreateHoldForm from './CreateHoldForm'

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

function getDisplayStatus(r: Reservation) {
	const now = new Date()
	const expiresAt = new Date(r.expiresAt)

	if (r.status === 'HOLD' && expiresAt <= now) {
		return 'EXPIRED (was HOLD)'
	}

	return r.status
}

export default async function ReservationsPage() {
	const [reservationsRes, lockersRes] = await Promise.all([
		fetch('http://localhost:3001/reservations', { cache: 'no-store' }),
		fetch('http://localhost:3001/lockers', { cache: 'no-store' }),
	])

	const reservations: Reservation[] = await reservationsRes.json()
	const lockers: Locker[] = await lockersRes.json()

	return (
		<main style={{ padding: 24, maxWidth: 720 }}>
			<h1>Reservations</h1>

			<CreateHoldForm lockers={lockers} />

			<hr style={{ margin: '24px 0' }} />

			<ul style={{ paddingLeft: 18 }}>
				{reservations.map((r) => {
					const displayStatus = getDisplayStatus(r)
					const isExpired = displayStatus.startsWith('EXPIRED')

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
						</li>
					)
				})}
			</ul>
		</main>
	)
}