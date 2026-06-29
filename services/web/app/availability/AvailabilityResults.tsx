type Locker = {
	id: string
	code: string
	location: string
	isActive: boolean
	createdAt: string
	updatedAt: string
}

export default function AvailabilityResults({
	lockers,
}: {
	lockers: Locker[]
}) {
	if (lockers.length === 0) {
		return (
			<p className="empty-state" style={{ marginTop: 16 }}>
				No lockers available for this time range.
			</p>
		)
	}

	return (
		<section style={{ marginTop: 20 }}>
			<h2 className="section-title">Available lockers</h2>

			<div className="grid action-grid">
				{lockers.map((locker) => (
					<article key={locker.id} className="card card-pad">
						<strong>{locker.code}</strong>
						<p className="metric-note">{locker.location}</p>
					</article>
				))}
			</div>
		</section>
	)
}
