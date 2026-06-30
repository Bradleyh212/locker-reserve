'use client'

import { themeOptions } from '../lib/theme'
import { useTheme } from './ThemeProvider'

export default function ThemeSelector() {
	const { resolvedTheme, setTheme, theme } = useTheme()

	return (
		<div className="theme-selector" role="group" aria-label="Theme">
			{themeOptions.map((option) => {
				const active = option.value === theme
				const title =
					option.value === 'system'
						? `System theme (${resolvedTheme})`
						: `${option.label} theme`

				return (
					<button
						key={option.value}
						type="button"
						className={`theme-option${active ? ' theme-option-active' : ''}`}
						aria-pressed={active}
						title={title}
						onClick={() => setTheme(option.value)}
					>
						{option.label}
					</button>
				)
			})}
		</div>
	)
}
