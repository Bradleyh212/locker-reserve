import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { ThemeProvider } from './components/ThemeProvider'
import { THEME_STORAGE_KEY } from './lib/theme'
import './globals.css'

const geistSans = Geist({
	variable: '--font-geist-sans',
	subsets: ['latin'],
})

const geistMono = Geist_Mono({
	variable: '--font-geist-mono',
	subsets: ['latin'],
})

export const metadata: Metadata = {
	title: 'Locker Reserve Admin',
	description: 'Admin dashboard for locker reservations',
}

const themeInitScript = `
(function() {
	try {
		var key = '${THEME_STORAGE_KEY}';
		var mode = window.localStorage.getItem(key);
		if (mode !== 'light' && mode !== 'dark' && mode !== 'system') {
			mode = 'system';
		}
		var systemDark = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
		var resolved = mode === 'dark' || (mode === 'system' && systemDark) ? 'dark' : 'light';
		document.documentElement.dataset.theme = resolved;
		document.documentElement.dataset.themeMode = mode;
		document.documentElement.style.colorScheme = resolved;
	} catch (error) {
		var fallbackDark = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
		var fallbackResolved = fallbackDark ? 'dark' : 'light';
		document.documentElement.dataset.theme = fallbackResolved;
		document.documentElement.dataset.themeMode = 'system';
		document.documentElement.style.colorScheme = fallbackResolved;
	}
})();
`

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode
}>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body
				className={`${geistSans.variable} ${geistMono.variable} antialiased`}
			>
				<script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
				<ThemeProvider>{children}</ThemeProvider>
			</body>
		</html>
	)
}
