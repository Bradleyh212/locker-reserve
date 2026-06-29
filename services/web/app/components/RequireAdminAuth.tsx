'use client'

import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
	ADMIN_SESSION_CHANGED_EVENT,
	fetchAdminSession,
	logoutAdmin,
} from '../lib/auth'

const navItems = [
	{ href: '/', label: 'Dashboard' },
	{ href: '/lockers', label: 'Lockers' },
	{ href: '/reservations', label: 'Reservations' },
	{ href: '/availability', label: 'Availability' },
]

export default function RequireAdminAuth({
	children,
}: {
	children: ReactNode
}) {
	const router = useRouter()
	const pathname = usePathname()
	const [checking, setChecking] = useState(true)
	const [authenticated, setAuthenticated] = useState(false)

	const checkSession = useCallback(async () => {
		setChecking(true)

		try {
			const sessionIsValid = await fetchAdminSession()

			if (!sessionIsValid) {
				setAuthenticated(false)
				router.replace('/login')
				return
			}

			setAuthenticated(true)
		} catch {
			setAuthenticated(false)
			router.replace('/login')
		} finally {
			setChecking(false)
		}
	}, [router])

	useEffect(() => {
		checkSession()

		window.addEventListener(ADMIN_SESSION_CHANGED_EVENT, checkSession)

		return () => {
			window.removeEventListener(ADMIN_SESSION_CHANGED_EVENT, checkSession)
		}
	}, [checkSession])

	async function signOut() {
		await logoutAdmin()
		router.replace('/login')
	}

	if (checking || !authenticated) {
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
