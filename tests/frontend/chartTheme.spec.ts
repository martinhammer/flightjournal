import { describe, it, expect, afterEach } from 'vitest'
import { FILL_OPACITY, PALETTE_OPACITY, readChartTheme, themeCssVars } from '../../src/chartTheme.ts'
import { blend, contrast, parseColor, toHex } from '../../src/colorRamp.ts'

const VARS = ['--color-primary-element', '--color-main-text', '--color-text-maxcontrast', '--color-main-background', '--color-border']

afterEach(() => {
	for (const v of VARS) {
		document.documentElement.style.removeProperty(v)
		document.body.style.removeProperty(v)
	}
})

describe('readChartTheme', () => {
	it('reads the body, where an explicitly chosen theme puts its variables', () => {
		// "System default" on a light OS sets :root; choosing Dark adds
		// body[data-theme-dark] with its own values. The body must win.
		document.documentElement.style.setProperty('--color-primary-element', '#00679e')
		document.body.style.setProperty('--color-primary-element', '#0091f2')
		document.body.style.setProperty('--color-main-background', '#171717')
		document.body.style.setProperty('--color-main-text', '#EBEBEB')
		const theme = readChartTheme()
		expect(theme.primarySolid).toBe('#0091f2')
		expect(theme.surface).toBe('#171717')
	})

	it('softens fills to the colour they show as at FILL_OPACITY over the surface', () => {
		document.body.style.setProperty('--color-primary-element', '#00679e')
		document.body.style.setProperty('--color-main-background', '#ffffff')
		const theme = readChartTheme()
		expect(theme.primary).toBe(toHex(blend(parseColor('#00679e')!, parseColor('#ffffff')!, FILL_OPACITY)))
		expect(theme.primary).not.toBe(theme.primarySolid)
	})

	it('softens a pale accent less, keeping single-series fills at 3:1', () => {
		// A yellow accent after Nextcloud lifts it to its ~3.2:1 element floor.
		document.body.style.setProperty('--color-primary-element', '#a98d00')
		document.body.style.setProperty('--color-main-background', '#ffffff')
		const theme = readChartTheme()
		const ratio = contrast(parseColor(theme.primary)!, parseColor('#ffffff')!)
		expect(ratio).toBeGreaterThanOrEqual(3)
		expect(ratio).toBeLessThan(3.1)
	})

	it('falls back to the stock light theme for missing or unparseable values', () => {
		document.body.style.setProperty('--color-primary-element', 'var(--nope)')
		const theme = readChartTheme()
		expect(theme.primarySolid).toBe('#00679e')
		expect(theme.surface).toBe('#ffffff')
		expect(theme.palette).toHaveLength(5)
	})

	for (const [name, primary, surface] of [['light', '#00679e', '#ffffff'], ['dark', '#0091f2', '#171717']]) {
		it(`builds one five-step palette from tickbuddy's 20%–85% range on the ${name} theme`, () => {
			document.body.style.setProperty('--color-primary-element', primary)
			document.body.style.setProperty('--color-main-background', surface)
			const theme = readChartTheme()
			expect(PALETTE_OPACITY[0]).toBe(0.2)
			expect(PALETTE_OPACITY[4]).toBe(0.85)
			expect(theme.palette).toEqual(PALETTE_OPACITY.map((o) => toHex(blend(parseColor(primary)!, parseColor(surface)!, o))))
			// Each step stands further out from the surface than the last.
			const ratios = theme.palette.map((c) => contrast(parseColor(c)!, parseColor(surface)!))
			for (let i = 1; i < ratios.length; i++) expect(ratios[i]).toBeGreaterThan(ratios[i - 1])
			// Bars and other single-series fills are the palette's fourth step.
			expect(FILL_OPACITY).toBe(PALETTE_OPACITY[3])
			expect(theme.primary).toBe(theme.palette[3])
		})
	}

	it('exposes the same colours to CSS', () => {
		const theme = readChartTheme()
		const vars = themeCssVars(theme)
		expect(vars['--fj-chart-primary']).toBe(theme.primary)
		expect([1, 2, 3, 4, 5].map((i) => vars[`--fj-palette-${i}`])).toEqual(theme.palette)
	})
})
