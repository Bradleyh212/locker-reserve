'use client'

import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { clearAdminToken, getAdminToken } from '../lib/auth'

export default function RequireAdminAuth({
	children,
}: {
	children: ReactNode
}) {
	const router = useRouter()
	const [isAuthorized, setIsAuthorized] = useState(false)

	useEffect(() => {
		if (!getAdminToken()) {
			router.replace('/login')
			return
		}

		setIsAuthorized(true)
	}, [router])

	function signOut() {
		clearAdminToken()
		router.replace('/login')
	}

	if (!isAuthorized) {
		return (
			<main style={{ padding: 24, maxWidth: 720 }}>
				<p>Checking session...</p>
			</main>
		)
	}

	return (
		<>
			<header
				style={{
					padding: '16px 24px',
					borderBottom: '1px solid #333',
					display: 'flex',
					justifyContent: 'space-between',
					alignItems: 'center',
				}}
			>
				<a href="/" style={{ color: 'inherit', textDecoration: 'none' }}>
					Locker Reserve
				</a>
				<button type="button" onClick={signOut}>
					Sign out
				</button>
			</header>
			{children}
		</>
	)
}
