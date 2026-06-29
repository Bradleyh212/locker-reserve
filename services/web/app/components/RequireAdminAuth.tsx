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
			<main className="page">
				<p className="loading-state">Checking session...</p>
			</main>
		)
	}

	return (
		<div className="app-shell">
			<header className="app-header">
				<div className="nav-row">
					<Link href="/" className="brand-link">
						Locker Reserve
					</Link>
					<nav aria-label="Admin navigation" className="nav-row">
						{navItems.map((item) => {
							const active = pathname === item.href

							return (
								<Link
									key={item.href}
									href={item.href}
									className={`nav-link${active ? ' nav-link-active' : ''}`}
								>
									{item.label}
								</Link>
							)
						})}
					</nav>
				</div>
				<button type="button" onClick={signOut} className="button button-secondary">
					Logout
				</button>
			</header>
			{children}
		</div>
	)
}
