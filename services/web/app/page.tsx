export default function HomePage() {
	const cards = [
		{
			title: 'Lockers',
			description: 'Create lockers and manage active/inactive status.',
			href: '/lockers',
		},
		{
			title: 'Reservations',
			description: 'Create holds, confirm reservations, and cancel bookings.',
			href: '/reservations',
		},
		{
			title: 'Availability',
			description: 'Check which lockers are available for a specific time range.',
			href: '/availability',
		},
	]

	return (
		<main
			style={{
				padding: 32,
				maxWidth: 1000,
				margin: '0 auto',
			}}
		>
			<section style={{ marginBottom: 32 }}>
				<h1 style={{ fontSize: '2.25rem', marginBottom: 12 }}>
					Locker Reserve Dashboard
				</h1>
				<p style={{ fontSize: '1rem', opacity: 0.85, maxWidth: 700 }}>
					Manage lockers, reservations, and availability from one place.
				</p>
			</section>

			<section
				style={{
					display: 'grid',
					gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
					gap: 16,
				}}
			>
				{cards.map((card) => (
					<a
						key={card.href}
						href={card.href}
						style={{
							display: 'block',
							padding: 20,
							border: '1px solid #333',
							borderRadius: 12,
							backgroundColor: '#111',
							color: 'white',
							textDecoration: 'none',
						}}
					>
						<h2 style={{ marginBottom: 10, fontSize: '1.25rem' }}>
							{card.title}
						</h2>
						<p style={{ opacity: 0.8, lineHeight: 1.5 }}>
							{card.description}
						</p>
					</a>
				))}
			</section>
		</main>
	)
}