'use client'

import type { ReactNode } from 'react'
import { useEffect, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
	ADMIN_TOKEN_CHANGED_EVENT,
	clearAdminToken,
	getAdminToken,
} from '../lib/auth'

const TOKEN_PENDING = '__locker_reserve_token_pending__'
const navItems = [
	{ href: '/', label: 'Dashboard' },
	{ href: '/lockers', label: 'Lockers' },
	{ href: '/reservations', label: 'Reservations' },
	{ href: '/availability', label: 'Availability' },
]

function subscribeToTokenChanges(onStoreChange: () => void) {
	window.addEventListener('storage', onStoreChange)
	window.addEventListener(ADMIN_TOKEN_CHANGED_EVENT, onStoreChange)

	return () => {
		window.removeEventListener('storage', onStoreChange)
		window.removeEventListener(ADMIN_TOKEN_CHANGED_EVENT, onStoreChange)
	}
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
	const pathname = usePathname()
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
					flexWrap: 'wrap',
					gap: 16,
					justifyContent: 'space-between',
					alignItems: 'center',
				}}
			>
				<div
					style={{
						display: 'flex',
						flexWrap: 'wrap',
						gap: 14,
						alignItems: 'center',
					}}
				>
					<Link
						href="/"
						style={{
							color: 'inherit',
							fontWeight: 700,
							textDecoration: 'none',
						}}
					>
						Locker Reserve
					</Link>
					<nav
						aria-label="Admin navigation"
						style={{
							display: 'flex',
							flexWrap: 'wrap',
							gap: 10,
							alignItems: 'center',
						}}
					>
						{navItems.map((item) => {
							const active = pathname === item.href

							return (
								<Link
									key={item.href}
									href={item.href}
									style={{
										color: active ? 'white' : '#c7c7c7',
										textDecoration: 'none',
										borderBottom: active
											? '2px solid white'
											: '2px solid transparent',
										paddingBottom: 2,
									}}
								>
									{item.label}
								</Link>
							)
						})}
					</nav>
				</div>
				<button type="button" onClick={signOut}>
					Logout
				</button>
			</header>
			{children}
		</>
	)
}
