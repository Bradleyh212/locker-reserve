export const THEME_STORAGE_KEY = 'locker-reserve-theme'

export type ThemeMode = 'light' | 'dark' | 'system'

export const themeModes: ThemeMode[] = ['light', 'dark', 'system']

export const themeOptions: Array<{ label: string; value: ThemeMode }> = [
	{ label: 'Light', value: 'light' },
	{ label: 'Dark', value: 'dark' },
	{ label: 'System', value: 'system' },
]
