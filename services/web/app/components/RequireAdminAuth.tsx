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
	{ href: '/', label: 'Dashboard', icon: 'D' },
	{ href: '/lockers', label: 'Lockers', icon: 'L' },
	{ href: '/reservations', label: 'Reservations', icon: 'R' },
	{ href: '/availability', label: 'Availability', icon: 'A' },
	{ href: '/book', label: 'Booking', icon: 'B' },
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
		<div className="admin-layout">
			<aside className="sidebar">
				<div>
					<div className="sidebar-brand">
						<span className="brand-mark">LR</span>
						<Link href="/" className="brand-link">
						Locker Reserve
					</Link>
					</div>
					<nav aria-label="Admin navigation" className="sidebar-nav">
						{navItems.map((item) => {
							const active = pathname === item.href

							return (
								<Link
									key={item.href}
									href={item.href}
									className={`sidebar-link${
										active ? ' sidebar-link-active' : ''
									}`}
								>
									<span className="nav-icon">{item.icon}</span>
									{item.label}
								</Link>
							)
						})}
					</nav>
				</div>
				<button
					type="button"
					onClick={signOut}
					className="button button-secondary"
				>
					Logout
				</button>
			</aside>
			<div className="admin-main">
				<header className="topbar">
					<span className="avatar">A</span>
					<div>
						<p className="admin-name">Admin</p>
						<p className="admin-role">Administrator</p>
					</div>
				</header>
				{children}
			</div>
		</div>
	)
}
