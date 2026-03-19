import CreateLockerForm from './CreateLockerForm'
import LockersList from './LockersList'

type Locker = {
	id: string
	code: string
	location: string
	isActive: boolean
	createdAt: string
	updatedAt: string
}

export default async function LockersPage() {
	const res = await fetch('http://localhost:3001/lockers', { cache: 'no-store' })
	const lockers: Locker[] = await res.json()

	return (
		<main style={{ padding: 24, maxWidth: 720 }}>
			<h1>Lockers</h1>

			<CreateLockerForm />

			<hr style={{ margin: '24px 0' }} />

			<LockersList lockers={lockers} />
		</main>
	)
}