'use client'

import { useState } from 'react'
import { apiUrl, authFetch } from '../lib/auth'
import { formatDateTime, getApiErrorMessage } from '../lib/ui'

type Locker = {
	id: string
	code: string
	location: string
	isActive: boolean
	createdAt: string
	updatedAt: string
}

export default function LockersList({
	lockers,
	onChanged,
}: {
	lockers: Locker[]
	onChanged: () => void
}) {
	const [loadingId, setLoadingId] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	async function toggleActive(locker: Locker) {
		if (
			locker.isActive &&
			!window.confirm(
				`Deactivate locker ${locker.code}? It will be hidden from public availability searches.`,
			)
		) {
			return
		}

		setError(null)
		setLoadingId(locker.id)

		try {
			const res = await authFetch(apiUrl(`/lockers/${locker.id}`), {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ isActive: !locker.isActive }),
			})

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				setError(getApiErrorMessage(data, `Request failed (${res.status})`))
				return
			}

			onChanged()
		} catch (e: any) {
			setError(e?.message ?? 'Network error')
		} finally {
			setLoadingId(null)
		}
	}

	return (
		<section>
			<div className="page-header" style={{ marginBottom: 12 }}>
				<div>
					<h2 className="section-title">Lockers</h2>
					<p className="metric-note">
						{lockers.length} locker{lockers.length === 1 ? '' : 's'} in inventory
					</p>
				</div>
			</div>

			{error ? <p className="alert alert-error">{error}</p> : null}

			{lockers.length === 0 ? (
				<p className="empty-state">No lockers have been created yet.</p>
			) : (
				<div className="table-wrap">
					<table className="table">
						<thead>
							<tr>
								<th>Code</th>
								<th>Location</th>
								<th>Status</th>
								<th>Updated</th>
								<th>Action</th>
							</tr>
						</thead>
						<tbody>
							{lockers.map((locker) => (
								<tr key={locker.id}>
									<td>
										<strong>{locker.code}</strong>
									</td>
									<td>{locker.location}</td>
									<td>
										<span
											className={
												locker.isActive
													? 'badge badge-success'
													: 'badge badge-muted'
											}
										>
											{locker.isActive ? 'Active' : 'Inactive'}
										</span>
									</td>
									<td>{formatDateTime(locker.updatedAt)}</td>
									<td>
										<button
											onClick={() => toggleActive(locker)}
											disabled={loadingId === locker.id}
											className={
												locker.isActive
													? 'button button-danger'
													: 'button button-secondary'
											}
										>
											{loadingId === locker.id
												? 'Updating...'
												: locker.isActive
													? 'Deactivate'
													: 'Activate'}
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	)
}
