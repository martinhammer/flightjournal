// Chrome on Android (since 108) and Safari shrink only the *visual* viewport
// for the on-screen keyboard; the layout viewport, and with it every
// `position: fixed` box, keeps its full height. A full-screen dialog's
// scroller then runs on behind the keyboard, and the browser sees no reason
// to scroll a focused field that is "on screen" under it. This publishes the
// height the keyboard covers as `--fj-keyboard-inset` on the root element, for
// `styles/views.css` to take off the dialog, and brings the focused field back
// into view, with any hint lines its dialog marks as belonging to it.

export const KEYBOARD_INSET_VAR = '--fj-keyboard-inset'

// The height at the bottom of the layout viewport hidden by the keyboard, in px.
export function keyboardInset(win: Pick<Window, 'innerHeight' | 'visualViewport'> = window): number {
	const vv = win.visualViewport
	if (!vv) return 0
	return Math.max(0, Math.round(win.innerHeight - vv.height - vv.offsetTop))
}

// What to bring into view for a focused control: the outermost block marked
// `data-fj-reveal` around it (a field with its hint lines), else the control's
// own wrapper, whose border the bare <input> lacks.
export function revealTarget(focused: HTMLElement): Element {
	let target: Element = focused.closest('.input-field, .v-select') ?? focused
	for (let el = focused.closest('[data-fj-reveal]'); el; el = el.parentElement?.closest('[data-fj-reveal]') ?? null) {
		target = el
	}
	return target
}

function revealFocused(): void {
	const focused = document.activeElement
	if (keyboardInset() === 0 || !(focused instanceof HTMLElement) || !focused.closest('.modal-container')) return
	// After layout: the dialog has shrunk, or the browser has done its own scroll.
	requestAnimationFrame(() => revealTarget(focused).scrollIntoView({ block: 'nearest' }))
}

export function trackKeyboardInset(): void {
	const vv = window.visualViewport
	if (!vv) return
	const root = document.documentElement
	const update = () => {
		root.style.setProperty(KEYBOARD_INSET_VAR, `${keyboardInset()}px`)
		revealFocused()
	}
	vv.addEventListener('resize', update)
	vv.addEventListener('scroll', update)
	// Moving to another field while the keyboard stays up resizes nothing.
	document.addEventListener('focusin', revealFocused)
	update()
}
