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
		return <p style={{ marginTop: 16 }}>No lockers available for this time range.</p>
	}

	return (
		<section style={{ marginTop: 20 }}>
			<h2>Available Lockers</h2>

			<ul style={{ paddingLeft: 18 }}>
				{lockers.map((locker) => (
					<li key={locker.id} style={{ marginBottom: 10 }}>
						<b>{locker.code}</b> — {locker.location}
					</li>
				))}
			</ul>
		</section>
	)
}