/**
 * Nextcloud theme → chart colours, kept live.
 *
 * A canvas cannot resolve CSS variables, so Chart.js needs concrete colours.
 * This reads them from the theme, derives the one palette every chart on the
 * page draws from, and re-reads when the theme can change under the page.
 *
 * Read from `document.body`, not `document.documentElement`: the default theme
 * and the OS-following light/dark sheets set the variables on `:root`, but a
 * theme the user explicitly chose sets them on `body[data-theme-<id>]`. Reading
 * the root would give a user who picked "Dark" on a light OS the light colours.
 */
import { onBeforeUnmount, onMounted, readonly, ref, type Ref } from 'vue'
import type { ChartOptions } from 'chart.js'
import { blend, soften, parseColor, toHex, towardBackground, LIGHT_END_CONTRAST, type Rgb } from './colorRamp.ts'

/**
 * The page's one palette: the solid primary at these opacities, faintest
 * first. Every slice of every sliced chart (the doughnuts, the weekday polar
 * chart) takes one of these five, so the same shade means the same thing
 * wherever it appears. The ends are tickbuddy's polar-chart range, evenly
 * stepped.
 *
 * Each is applied as the opaque colour that opacity produces over the page
 * background (`blend`), not as an rgba fill: identical on the plain surface,
 * but an HTML swatch then matches its canvas mark wherever it sits.
 *
 * The pale end is below the 2:1 a filled mark needs on its own, which is why
 * every sliced chart outlines its slices in the solid primary: the outline
 * carries the shape, the shade only grades it.
 */
export const PALETTE_OPACITY = [0.2, 0.3625, 0.525, 0.6875, 0.85] as const

/**
 * Opacity of single-series fills — bars, ranked bars, meters: the palette's
 * fourth step. Solid primary fills read as too heavy across a page of charts.
 * Unlike slices these have no outline, so a pale accent is softened less to
 * keep them at 3:1 (`soften`); on the stock themes this is exactly step four.
 */
export const FILL_OPACITY = PALETTE_OPACITY[3]

export interface ChartTheme {
	/** Single-series fills: the primary element colour at {@link FILL_OPACITY}. */
	primary: string
	/** The primary at full strength, for lines and focus rather than fills. */
	primarySolid: string
	/** Main text: values and direct labels. */
	text: string
	/** Secondary text: axis ticks, legends, captions. */
	textMuted: string
	/** Hairline gridlines and axes. */
	grid: string
	/** The chart surface. */
	surface: string
	/** "No data" / "Other" slices: outside the palette, as they're outside the scale. */
	neutral: string
	/** Font stack, so canvas text matches the page. */
	font: string
	/** The five slice shades, faintest first — see {@link PALETTE_OPACITY}. */
	palette: readonly string[]
}

// The stock light theme, used when a variable is missing or unparseable
// (tests, or a theme that emits a syntax `parseColor` does not handle).
const FALLBACK = {
	primary: '#00679e',
	text: '#222222',
	textMuted: '#6b6b6b',
	grid: '#ededed',
	surface: '#ffffff',
	font: 'system-ui, sans-serif',
}

function cssVar(style: CSSStyleDeclaration, name: string): string {
	return style.getPropertyValue(name).trim()
}

function color(style: CSSStyleDeclaration, name: string, fallback: string): Rgb {
	return parseColor(cssVar(style, name)) ?? parseColor(fallback)!
}

/**
 * Snapshot the current theme.
 *
 * @param el Where to read the variables; `document.body` unless testing.
 */
export function readChartTheme(el: Element = document.body): ChartTheme {
	const style = getComputedStyle(el)
	const primary = color(style, '--color-primary-element', FALLBACK.primary)
	const text = color(style, '--color-main-text', FALLBACK.text)
	const textMuted = color(style, '--color-text-maxcontrast', FALLBACK.textMuted)
	const surface = color(style, '--color-main-background', FALLBACK.surface)
	return {
		primary: toHex(soften(primary, surface, FILL_OPACITY)),
		primarySolid: toHex(primary),
		text: toHex(text),
		textMuted: toHex(textMuted),
		grid: toHex(color(style, '--color-border', FALLBACK.grid)),
		surface: toHex(surface),
		neutral: toHex(towardBackground(textMuted, surface, LIGHT_END_CONTRAST)),
		font: cssVar(style, '--font-face') || FALLBACK.font,
		palette: PALETTE_OPACITY.map((opacity) => toHex(blend(primary, surface, opacity))),
	}
}

/**
 * The current theme as a ref that follows changes while the component is
 * mounted. Two things can change it without a reload:
 *  - the OS colour scheme or contrast preference, when the user's theme is
 *    "System default" (Nextcloud attaches the light/dark sheets with `media`);
 *  - the `data-theme-*` attributes on `<body>`, which the theming settings
 *    toggle in place.
 * A changed accent colour or explicit theme otherwise arrives with the next
 * page load, which this picks up on mount.
 */
export function useChartTheme(): Readonly<Ref<ChartTheme>> {
	const theme = ref<ChartTheme>(readChartTheme())
	// Wait a frame so the browser has applied the switched stylesheet.
	const refresh = () => requestAnimationFrame(() => { theme.value = readChartTheme() })
	const queries = ['(prefers-color-scheme: dark)', '(prefers-contrast: more)']
		.map((q) => window.matchMedia?.(q))
		.filter((q): q is MediaQueryList => !!q)
	const observer = typeof MutationObserver === 'undefined'
		? null
		: new MutationObserver(refresh)

	onMounted(() => {
		theme.value = readChartTheme()
		for (const q of queries) q.addEventListener('change', refresh)
		observer?.observe(document.body, { attributes: true, attributeFilter: ['data-themes'] })
	})
	onBeforeUnmount(() => {
		for (const q of queries) q.removeEventListener('change', refresh)
		observer?.disconnect()
	})
	return readonly(theme) as Readonly<Ref<ChartTheme>>
}

/**
 * The theme-dependent options every chart shares: text, gridlines, font,
 * tooltip. Merge chart-specific options over it. Passed per chart rather than
 * via `Chart.defaults` so a theme change re-renders through ordinary
 * reactivity, with no global state to mutate.
 *
 * @param theme The current theme.
 */
export function baseChartOptions(theme: ChartTheme): ChartOptions<'bar'> {
	const axis = {
		grid: { color: theme.grid, tickColor: theme.grid },
		border: { color: theme.grid },
		ticks: { color: theme.textMuted, font: { family: theme.font } },
	}
	return {
		responsive: true,
		maintainAspectRatio: false,
		animation: false,
		font: { family: theme.font },
		color: theme.textMuted,
		scales: { x: { ...axis }, y: { ...axis } },
		plugins: {
			legend: { display: false },
			tooltip: {
				// Follows the pointer (see `chartPlugins.ts`) rather than pinning
				// to the bar.
				position: 'cursor',
				caretPadding: 8,
				titleFont: { family: theme.font },
				bodyFont: { family: theme.font },
				// The footer carries hints ("Click to see these flights"), not data.
				footerFont: { family: theme.font, weight: 'normal' },
			},
		},
	} as ChartOptions<'bar'>
}

/**
 * The same colours as CSS custom properties, for the HTML around the charts
 * (ranked bars, meters, swatches), so both read from one computation:
 * `--fj-chart-primary`, `--fj-chart-neutral` and `--fj-palette-1` … `-5`.
 *
 * @param theme The current theme.
 */
export function themeCssVars(theme: ChartTheme): Record<string, string> {
	const vars: Record<string, string> = {
		'--fj-chart-primary': theme.primary,
		'--fj-chart-neutral': theme.neutral,
	}
	theme.palette.forEach((c, i) => { vars[`--fj-palette-${i + 1}`] = c })
	return vars
}
