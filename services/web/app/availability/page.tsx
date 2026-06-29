import RequireAdminAuth from '../components/RequireAdminAuth'
import CheckAvailabilityForm from './CheckAvailabilityForm'

export default function AvailabilityPage() {
	return (
		<RequireAdminAuth>
			<main className="page">
				<section className="page-header">
					<div>
						<p className="eyebrow">Capacity</p>
						<h1 className="page-title">Availability</h1>
						<p className="lede">
							Check active lockers for a location and reservation time window.
						</p>
					</div>
				</section>
				<CheckAvailabilityForm />
			</main>
		</RequireAdminAuth>
	)
}
