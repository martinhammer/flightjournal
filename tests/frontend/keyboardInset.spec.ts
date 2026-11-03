import { describe, expect, it } from 'vitest'
import { keyboardInset, revealTarget } from '../../src/keyboardInset.ts'

const win = (innerHeight: number, vv: { height: number, offsetTop: number } | null) =>
	({ innerHeight, visualViewport: vv as VisualViewport | null })

describe('keyboardInset', () => {
	it('is the part of the layout viewport the keyboard covers', () => {
		expect(keyboardInset(win(915, { height: 520, offsetTop: 0 }))).toBe(395)
	})

	it('does not count a visual viewport scrolled down the page', () => {
		expect(keyboardInset(win(915, { height: 520, offsetTop: 100 }))).toBe(295)
	})

	it('is zero with no keyboard, or without visualViewport', () => {
		expect(keyboardInset(win(915, { height: 915, offsetTop: 0 }))).toBe(0)
		expect(keyboardInset(win(915, null))).toBe(0)
	})
})

describe('revealTarget', () => {
	const build = (html: string) => {
		document.body.innerHTML = html
		return document.querySelector('input') as HTMLElement
	}

	it('reveals the outermost marked block, hint lines included', () => {
		const input = build('<div class="field" data-fj-reveal><div class="aircraft" data-fj-reveal><div class="input-field"><input></div></div><p>hint</p></div>')
		expect(revealTarget(input).className).toBe('field')
	})

	it('falls back to the control\'s wrapper, which carries its border', () => {
		const input = build('<div class="input-field"><div><input></div></div>')
		expect(revealTarget(input).className).toBe('input-field')
	})

	it('falls back to the control itself', () => {
		const input = build('<input>')
		expect(revealTarget(input)).toBe(input)
	})
})
