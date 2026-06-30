'use client'

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useSyncExternalStore,
} from 'react'
import { THEME_STORAGE_KEY, type ThemeMode, themeModes } from '../lib/theme'

type ResolvedTheme = 'light' | 'dark'
type ThemeSnapshot = `${ThemeMode}:${ResolvedTheme}`

type ThemeContextValue = {
	theme: ThemeMode
	resolvedTheme: ResolvedTheme
	setTheme: (theme: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
const serverThemeSnapshot: ThemeSnapshot = 'system:light'
const themeListeners = new Set<() => void>()
let fallbackTheme: ThemeMode = 'system'

export function ThemeProvider({ children }: { children: ReactNode }) {
	const snapshot = useSyncExternalStore(
		subscribeToThemeChanges,
		getThemeSnapshot,
		getServerThemeSnapshot,
	)
	const { resolvedTheme, theme } = parseThemeSnapshot(snapshot)

	useEffect(() => {
		applyTheme(theme, resolvedTheme)
	}, [resolvedTheme, theme])

	const setTheme = useCallback((nextTheme: ThemeMode) => {
		fallbackTheme = nextTheme

		try {
			window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
		} catch {
			// Theme persistence is best-effort when storage is unavailable.
		}

		applyTheme(nextTheme)
		emitThemeChange()
	}, [])

	const value = useMemo(
		() => ({ theme, resolvedTheme, setTheme }),
		[resolvedTheme, setTheme, theme],
	)

	return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
	const value = useContext(ThemeContext)

	if (!value) {
		throw new Error('useTheme must be used within ThemeProvider')
	}

	return value
}

function readStoredTheme(): ThemeMode {
	if (typeof window === 'undefined') {
		return fallbackTheme
	}

	try {
		const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)

		return isThemeMode(storedTheme) ? storedTheme : fallbackTheme
	} catch {
		return fallbackTheme
	}
}

function isThemeMode(value: string | null): value is ThemeMode {
	return Boolean(value && themeModes.includes(value as ThemeMode))
}

function applyTheme(
	theme: ThemeMode,
	resolvedTheme: ResolvedTheme = resolveTheme(theme),
) {
	if (typeof document === 'undefined') {
		return
	}

	const root = document.documentElement

	root.dataset.theme = resolvedTheme
	root.dataset.themeMode = theme
	root.style.colorScheme = resolvedTheme
}

function resolveTheme(theme: ThemeMode): ResolvedTheme {
	if (theme === 'light' || theme === 'dark') {
		return theme
	}

	if (typeof window === 'undefined') {
		return 'light'
	}

	if (typeof window.matchMedia !== 'function') {
		return 'light'
	}

	return window.matchMedia('(prefers-color-scheme: dark)').matches
		? 'dark'
		: 'light'
}

function subscribeToThemeChanges(callback: () => void) {
	if (typeof window === 'undefined') {
		return () => undefined
	}

	themeListeners.add(callback)

	const mediaQuery =
		typeof window.matchMedia === 'function'
			? window.matchMedia('(prefers-color-scheme: dark)')
			: null
	const handleSystemThemeChange = () => callback()
	const handleStorageChange = (event: StorageEvent) => {
		if (event.key === THEME_STORAGE_KEY) {
			callback()
		}
	}

	mediaQuery?.addEventListener('change', handleSystemThemeChange)
	window.addEventListener('storage', handleStorageChange)

	return () => {
		themeListeners.delete(callback)
		mediaQuery?.removeEventListener('change', handleSystemThemeChange)
		window.removeEventListener('storage', handleStorageChange)
	}
}

function emitThemeChange() {
	themeListeners.forEach((listener) => listener())
}

function getThemeSnapshot(): ThemeSnapshot {
	const theme = readStoredTheme()

	return `${theme}:${resolveTheme(theme)}`
}

function getServerThemeSnapshot() {
	return serverThemeSnapshot
}

function parseThemeSnapshot(snapshot: ThemeSnapshot) {
	const [theme, resolvedTheme] = snapshot.split(':') as [
		ThemeMode,
		ResolvedTheme,
	]

	return { theme, resolvedTheme }
}
