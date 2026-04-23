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

			<ReservationsList reservations={reservations} />
		</main>
	)
}