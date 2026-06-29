const API_BASE_URL =
	process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001'

export const ADMIN_SESSION_CHANGED_EVENT = 'locker-reserve-admin-session-changed'

export function apiUrl(path: string) {
	return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

function notifyAdminSessionChanged() {
	if (typeof window === 'undefined') {
		return
	}

	window.dispatchEvent(new Event(ADMIN_SESSION_CHANGED_EVENT))
}

export async function fetchAdminSession() {
	const response = await fetch(apiUrl('/auth/me'), {
		credentials: 'include',
		cache: 'no-store',
	})

	if (response.status === 401) {
		return false
	}

	if (!response.ok) {
		throw new Error(`Session check failed (${response.status})`)
	}

	return true
}

export async function logoutAdmin() {
	try {
		await fetch(apiUrl('/auth/logout'), {
			method: 'POST',
			credentials: 'include',
		})
	} finally {
		notifyAdminSessionChanged()
	}
}

export function redirectToLogin() {
	if (typeof window === 'undefined') {
		return
	}

	notifyAdminSessionChanged()
	window.location.assign('/login')
}

export async function authFetch(
	input: Parameters<typeof fetch>[0],
	init: RequestInit = {},
) {
	const headers = new Headers(init.headers)

	const response = await fetch(input, {
		...init,
		headers,
		credentials: init.credentials ?? 'include',
	})

	if (response.status === 401) {
		redirectToLogin()
	}

	return response
}
