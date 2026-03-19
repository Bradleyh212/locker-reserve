'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Locker = {
	id: string
	code: string
	location: string
	isActive: boolean
	createdAt: string
	updatedAt: string
}

export default function LockersList({ lockers }: { lockers: Locker[] }) {
	const router = useRouter()
	const [loadingId, setLoadingId] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	async function toggleActive(locker: Locker) {
		setError(null)
		setLoadingId(locker.id)

		try {
			const res = await fetch(`http://localhost:3001/lockers/${locker.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ isActive: !locker.isActive }),
			})

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				setError(data?.message ?? `Request failed (${res.status})`)
				return
			}

			router.refresh()
		} catch (e: any) {
			setError(e?.message ?? 'Network error')
		} finally {
			setLoadingId(null)
		}
	}

	return (
		<section style={{ marginTop: 16 }}>
			<h2>Lockers</h2>

			{error ? <p style={{ color: 'crimson' }}>{error}</p> : null}

			<ul style={{ paddingLeft: 18 }}>
				{lockers.map((l) => (
					<li key={l.id} style={{ marginBottom: 10 }}>
						<b>{l.code}</b> — {l.location} —{' '}
						<span style={{ opacity: 0.8 }}>{l.isActive ? 'Active' : 'Inactive'}</span>{' '}
						<button
							onClick={() => toggleActive(l)}
							disabled={loadingId === l.id}
							style={{ marginLeft: 10 }}
						>
							{loadingId === l.id
								? 'Updating...'
								: l.isActive
									? 'Deactivate'
									: 'Activate'}
						</button>
					</li>
				))}
			</ul>
		</section>
	)
}