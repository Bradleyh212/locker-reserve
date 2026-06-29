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
	{ href: '/', label: 'Dashboard', Icon: DashboardIcon },
	{ href: '/lockers', label: 'Lockers', Icon: LockerIcon },
	{ href: '/reservations', label: 'Reservations', Icon: ReservationIcon },
	{ href: '/availability', label: 'Availability', Icon: AvailabilityIcon },
	{ href: '/book', label: 'Booking', Icon: BookingIcon },
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
						<span className="brand-mark" aria-hidden="true">
							<LogoIcon />
						</span>
						<Link href="/" className="brand-link">
							Locker Reserve
						</Link>
					</div>
					<nav aria-label="Admin navigation" className="sidebar-nav">
						{navItems.map((item) => {
							const Icon = item.Icon
							const active =
								pathname === item.href ||
								(item.href !== '/' && pathname.startsWith(item.href))

							return (
								<Link
									key={item.href}
									href={item.href}
									className={`sidebar-link${
										active ? ' sidebar-link-active' : ''
									}`}
								>
									<span className="nav-icon" aria-hidden="true">
										<Icon />
									</span>
									<span>{item.label}</span>
								</Link>
							)
						})}
					</nav>
				</div>
				<button
					type="button"
					onClick={signOut}
					className="button button-secondary sidebar-logout"
				>
					<span className="nav-icon" aria-hidden="true">
						<LogoutIcon />
					</span>
					<span>Logout</span>
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

function LogoIcon() {
	return (
		<svg viewBox="0 0 24 24" fill="none">
			<path
				d="M7 3h9.5A2.5 2.5 0 0 1 19 5.5v13A2.5 2.5 0 0 1 16.5 21H7V3Z"
				stroke="currentColor"
				strokeWidth="1.8"
			/>
			<path d="M11 7h4M11 11h4M11 15h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
			<path d="M5 6h2M5 12h2M5 18h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
		</svg>
	)
}

function DashboardIcon() {
	return (
		<svg viewBox="0 0 24 24" fill="none">
			<path
				d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-8.5Z"
				stroke="currentColor"
				strokeWidth="1.8"
				strokeLinejoin="round"
			/>
		</svg>
	)
}

function LockerIcon() {
	return (
		<svg viewBox="0 0 24 24" fill="none">
			<rect x="5" y="4" width="14" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
			<path d="M12 4v16M8.5 8h1.5M8.5 12h1.5M14.5 8H16M14.5 12H16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
		</svg>
	)
}

function ReservationIcon() {
	return (
		<svg viewBox="0 0 24 24" fill="none">
			<rect x="4" y="5.5" width="16" height="14.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
			<path d="M8 3.5v4M16 3.5v4M4 10h16M8 14h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
		</svg>
	)
}

function AvailabilityIcon() {
	return (
		<svg viewBox="0 0 24 24" fill="none">
			<rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.8" />
			<path d="M8 3.5v3M16 3.5v3M4 10h16M8 15l2.2 2.2L15.5 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

function BookingIcon() {
	return (
		<svg viewBox="0 0 24 24" fill="none">
			<path
				d="M6 5h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
				stroke="currentColor"
				strokeWidth="1.8"
			/>
			<path d="M4 9h16M8 14h5M15.5 14H17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
		</svg>
	)
}

function LogoutIcon() {
	return (
		<svg viewBox="0 0 24 24" fill="none">
			<path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
			<path d="M14 8l4 4-4 4M18 12H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}
