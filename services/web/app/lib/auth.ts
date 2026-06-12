const API_BASE_URL =
	process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001'

const ADMIN_TOKEN_KEY = 'locker-reserve-admin-token'
export const ADMIN_TOKEN_CHANGED_EVENT = 'locker-reserve-admin-token-changed'

export function apiUrl(path: string) {
	return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

export function getAdminToken() {
	if (typeof window === 'undefined') {
		return null
	}

	return window.localStorage.getItem(ADMIN_TOKEN_KEY)
}

export function setAdminToken(token: string) {
	if (typeof window === 'undefined') {
		return
	}

	window.localStorage.setItem(ADMIN_TOKEN_KEY, token)
	window.dispatchEvent(new Event(ADMIN_TOKEN_CHANGED_EVENT))
}

export function clearAdminToken() {
	if (typeof window === 'undefined') {
		return
	}

	window.localStorage.removeItem(ADMIN_TOKEN_KEY)
	window.dispatchEvent(new Event(ADMIN_TOKEN_CHANGED_EVENT))
}

export function redirectToLogin() {
	if (typeof window === 'undefined') {
		return
	}

	clearAdminToken()
	window.location.assign('/login')
}

export async function authFetch(
	input: Parameters<typeof fetch>[0],
	init: RequestInit = {},
) {
	const headers = new Headers(init.headers)
	const token = getAdminToken()

	if (token) {
		headers.set('Authorization', `Bearer ${token}`)
	}

	const response = await fetch(input, {
		...init,
		headers,
	})

	if (response.status === 401) {
		redirectToLogin()
	}

	return response
}
