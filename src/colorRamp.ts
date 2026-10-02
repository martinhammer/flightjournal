/**
 * Colour maths for charts: parse the theme's colours, measure contrast, and
 * blend the user's primary over the background to build the page's palette
 * (see `chartTheme.ts`).
 *
 * Pure and dependency-free on purpose — it is unit-tested directly and is the
 * one place a chart colour is computed, so the canvas (Chart.js) and the HTML
 * around it (legends, ranked bars) use the same values rather than two
 * implementations that happen to agree.
 *
 * Why colours derived from the theme rather than fixed hexes: Nextcloud's
 * primary is per-user and per-theme (`#00679e` light, `#0091f2` dark by
 * default), and `Util::elementColor` only guarantees it about 3.2:1 against the
 * background. Why opaque blends rather than rgba fills: they composite the same
 * everywhere, so an HTML swatch matches its canvas mark without having to sit
 * on the same background, and their contrast can be measured.
 */

export interface Rgb {
	r: number
	g: number
	b: number
}

/** Minimum WCAG contrast of the neutral "Other" / "No data" grey (2:1 floor + margin). */
export const LIGHT_END_CONTRAST = 2.2

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/**
 * Parse a CSS colour as Nextcloud's theming emits it: `#rgb`, `#rrggbb` (any
 * case, with or without alpha) or `rgb()`/`rgba()` in comma or space syntax.
 * Alpha is ignored. Returns null for anything else (`var(…)`, `color-mix(…)`,
 * named colours) so the caller can fall back rather than draw `NaN`.
 *
 * @param value The CSS colour string.
 */
export function parseColor(value: string): Rgb | null {
	const v = value.trim().toLowerCase()
	const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v)
	if (hex) {
		let h = hex[1]
		if (h.length <= 4) h = [...h].map((c) => c + c).join('')
		return {
			r: parseInt(h.slice(0, 2), 16),
			g: parseInt(h.slice(2, 4), 16),
			b: parseInt(h.slice(4, 6), 16),
		}
	}
	const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(v)
	if (fn) {
		return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]) }
	}
	return null
}

/**
 * Serialise as `#rrggbb`.
 *
 * @param c The colour.
 */
export function toHex(c: Rgb): string {
	const part = (x: number) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')
	return `#${part(c.r)}${part(c.g)}${part(c.b)}`
}

const toLinear = (x: number) => {
	const s = x / 255
	return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const fromLinear = (x: number) => 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)

/**
 * WCAG relative luminance.
 *
 * @param c The colour.
 */
export function luminance(c: Rgb): number {
	return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b)
}

/**
 * WCAG contrast ratio, 1–21.
 *
 * @param a One colour.
 * @param b The other.
 */
export function contrast(a: Rgb, b: Rgb): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
	return (hi + 0.05) / (lo + 0.05)
}

type Lab = [number, number, number]

// OKLab (Björn Ottosson). Interpolating here keeps steps perceptually even.
function toOklab(c: Rgb): Lab {
	const r = toLinear(c.r)
	const g = toLinear(c.g)
	const b = toLinear(c.b)
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
	return [
		0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
	]
}

function fromOklab([L, a, b]: Lab): Rgb {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
	const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
	return {
		r: fromLinear(clamp01(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
		g: fromLinear(clamp01(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
		b: fromLinear(clamp01(-0.0041960771 * l - 0.7034186147 * m + 1.7076147010 * s)),
	}
}

/**
 * Mix two colours in OKLab: `t = 0` is `a`, `t = 1` is `b`.
 *
 * @param a Start colour.
 * @param b End colour.
 * @param t Position between them.
 */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
	const A = toOklab(a)
	const B = toOklab(b)
	return fromOklab([0, 1, 2].map((i) => A[i] + (B[i] - A[i]) * t) as Lab)
}

/**
 * The colour `color` shows as when drawn at `opacity` over `background` —
 * plain sRGB compositing, exactly what the browser does for a translucent fill.
 * Used to soften fills while keeping them opaque, so an HTML swatch matches its
 * canvas mark wherever it sits and contrast can still be measured.
 *
 * @param color The fill.
 * @param background The surface underneath.
 * @param opacity 0 (invisible) to 1 (solid).
 */
export function blend(color: Rgb, background: Rgb, opacity: number): Rgb {
	const ch = (c: number, b: number) => c * opacity + b * (1 - opacity)
	return { r: ch(color.r, background.r), g: ch(color.g, background.g), b: ch(color.b, background.b) }
}

/** Minimum WCAG contrast of a softened single-series fill (non-text graphics). */
export const FILL_MIN_CONTRAST = 3

/**
 * `color` blended to `opacity` over `background`, but never fainter than
 * `minContrast` against it: a pale accent (Nextcloud only guarantees about
 * 3.2:1) gets just as much extra opacity as it needs, up to fully solid.
 *
 * @param color The fill.
 * @param background The surface underneath.
 * @param opacity The preferred opacity.
 * @param minContrast The WCAG ratio to keep.
 */
export function soften(color: Rgb, background: Rgb, opacity: number, minContrast = FILL_MIN_CONTRAST): Rgb {
	if (contrast(blend(color, background, opacity), background) >= minContrast) return blend(color, background, opacity)
	if (contrast(color, background) <= minContrast) return color
	let lo = opacity
	let hi = 1
	for (let i = 0; i < 24; i++) {
		const mid = (lo + hi) / 2
		if (contrast(blend(color, background, mid), background) >= minContrast) hi = mid
		else lo = mid
	}
	return blend(color, background, hi)
}

/**
 * The palest mix of `color` toward `background` that still clears `minContrast`
 * against it. Returns `color` unchanged if it does not clear it to begin with.
 *
 * @param color The colour to lighten (or, on a dark background, darken).
 * @param background The surface the mark sits on.
 * @param minContrast The WCAG ratio to keep.
 */
export function towardBackground(color: Rgb, background: Rgb, minContrast: number): Rgb {
	if (contrast(color, background) <= minContrast) return color
	let lo = 0
	let hi = 1
	for (let i = 0; i < 24; i++) {
		const t = (lo + hi) / 2
		if (contrast(mix(color, background, t), background) >= minContrast) lo = t
		else hi = t
	}
	return mix(color, background, lo)
}
