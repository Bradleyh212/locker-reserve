import RequireAdminAuth from '../components/RequireAdminAuth'
import CheckAvailabilityForm from './CheckAvailabilityForm'

export default function AvailabilityPage() {
	return (
		<RequireAdminAuth>
			<main style={{ padding: 24, maxWidth: 720 }}>
				<h1>Availability</h1>
				<CheckAvailabilityForm />
			</main>
		</RequireAdminAuth>
	)
}
