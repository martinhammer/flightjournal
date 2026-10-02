import { describe, it, expect } from 'vitest'
import {
	LIGHT_END_CONTRAST,
	blend,
	contrast,
	parseColor,
	toHex,
	towardBackground,
	type Rgb,
} from '../../src/colorRamp.ts'

const rgb = (hex: string): Rgb => parseColor(hex)!

// The stock Nextcloud themes, as served by stable34's theming app.
const LIGHT = { primary: rgb('#00679e'), surface: rgb('#ffffff'), text: rgb('#222222') }

describe('parseColor', () => {
	it('reads the forms Nextcloud theming emits', () => {
		expect(parseColor('#00679e')).toEqual({ r: 0, g: 103, b: 158 })
		expect(parseColor('#EBEBEB')).toEqual({ r: 235, g: 235, b: 235 })
		expect(parseColor(' #fff ')).toEqual({ r: 255, g: 255, b: 255 })
		expect(parseColor('#00679e80')).toEqual({ r: 0, g: 103, b: 158 })
		expect(parseColor('rgb(0, 103, 158)')).toEqual({ r: 0, g: 103, b: 158 })
		expect(parseColor('rgba(0 103 158 / 0.5)')).toEqual({ r: 0, g: 103, b: 158 })
	})

	it('returns null for anything it cannot resolve rather than NaN channels', () => {
		expect(parseColor('var(--color-primary-light)')).toBeNull()
		expect(parseColor('color-mix(in srgb, red, blue)')).toBeNull()
		expect(parseColor('')).toBeNull()
	})
})

describe('contrast', () => {
	it('matches WCAG at the extremes', () => {
		expect(contrast(rgb('#ffffff'), rgb('#000000'))).toBeCloseTo(21, 5)
		expect(contrast(rgb('#00679e'), rgb('#00679e'))).toBe(1)
	})
})

describe('blend', () => {
	it('composites like a translucent fill over the surface', () => {
		expect(toHex(blend(rgb('#000000'), rgb('#ffffff'), 0.5))).toBe('#808080')
		expect(blend(rgb('#00679e'), rgb('#ffffff'), 1)).toEqual(rgb('#00679e'))
		expect(blend(rgb('#00679e'), rgb('#171717'), 0)).toEqual(rgb('#171717'))
	})
})

describe('towardBackground', () => {
	it('fades a colour toward the surface but keeps the contrast asked for', () => {
		const grey = towardBackground(rgb('#6b6b6b'), LIGHT.surface, LIGHT_END_CONTRAST)
		expect(contrast(grey, LIGHT.surface)).toBeGreaterThanOrEqual(LIGHT_END_CONTRAST - 0.01)
		expect(contrast(grey, LIGHT.surface)).toBeLessThan(contrast(rgb('#6b6b6b'), LIGHT.surface))
	})
})
