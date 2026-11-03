import { onScopeDispose, ref, type Ref } from 'vue'

// Width at and below which the tables render as cards. The CSS card rules use
// the same number in their media queries — change them together.
export const CARD_BREAKPOINT_PX = 700

/**
 * Whether the viewport is narrow enough for the card layout, kept in step
 * with the media query the CSS uses so script and styles never disagree about
 * which layout is showing. False where matchMedia is unavailable (jsdom).
 */
export function useCardLayout(): Ref<boolean> {
	const query = window.matchMedia?.(`(max-width: ${CARD_BREAKPOINT_PX}px)`)
	const matches = ref(query?.matches ?? false)
	const onChange = (e: MediaQueryListEvent) => {
		matches.value = e.matches
	}
	query?.addEventListener('change', onChange)
	onScopeDispose(() => query?.removeEventListener('change', onChange))
	return matches
}
