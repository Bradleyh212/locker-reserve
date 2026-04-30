'use client'

import type { ReactNode } from 'react'
import { useEffect, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { clearAdminToken, getAdminToken } from '../lib/auth'

const TOKEN_PENDING = '__locker_reserve_token_pending__'

function subscribeToTokenChanges(onStoreChange: () => void) {
	window.addEventListener('storage', onStoreChange)

	return () => window.removeEventListener('storage', onStoreChange)
}

function getTokenSnapshot() {
	return getAdminToken()
}

function getServerTokenSnapshot() {
	return TOKEN_PENDING
}

export default function RequireAdminAuth({
	children,
}: {
	children: ReactNode
}) {
	const router = useRouter()
	const token = useSyncExternalStore(
		subscribeToTokenChanges,
		getTokenSnapshot,
		getServerTokenSnapshot,
	)

	useEffect(() => {
		if (!token) {
			router.replace('/login')
		}
	}, [router, token])

	function signOut() {
		clearAdminToken()
		router.replace('/login')
	}

	if (!token || token === TOKEN_PENDING) {
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
				<Link href="/" style={{ color: 'inherit', textDecoration: 'none' }}>
					Locker Reserve
				</Link>
				<button type="button" onClick={signOut}>
					Sign out
				</button>
			</header>
			{children}
		</>
	)
}
