<script setup lang="ts">
/**
 * Read-only feedback under the Aircraft type field: what the text currently in
 * the field resolves to against the reference data.
 *
 * Shows what will happen on save rather than what happened last save. The
 * editor's whole point here is fixing an entry that did not resolve, and a badge
 * reporting the *stored* result would keep saying "no match" while you type the
 * correction — so it re-resolves as you type, debounced, against the server's
 * resolver.
 *
 * Deliberately does not report the flight's stored manufacturer/model. Those can
 * differ from a fresh resolve when a model was explicitly chosen (today only via
 * a JSON restore), and reconciling that distinction belongs with the override UI
 * that creates it, not here.
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { resolveAircraftType } from '../api.ts'

const props = defineProps<{ raw: string | null }>()

type State =
	| { kind: 'idle' }
	| { kind: 'checking' }
	| { kind: 'matched'; code: string; manufacturer: string | null; model: string | null }
	| { kind: 'unmatched' }
	| { kind: 'noReference' }
	| { kind: 'error' }

const state = ref<State>({ kind: 'idle' })

const DEBOUNCE_MS = 300
let timer: ReturnType<typeof setTimeout> | null = null
// Guards against a slow early request overwriting a newer one's result.
let token = 0

async function check(text: string) {
	const mine = ++token
	state.value = { kind: 'checking' }
	try {
		const { match, referenceLoaded } = await resolveAircraftType(text)
		if (mine !== token) return
		if (match) {
			state.value = { kind: 'matched', ...match }
		} else {
			state.value = { kind: referenceLoaded ? 'unmatched' : 'noReference' }
		}
	} catch {
		if (mine !== token) return
		state.value = { kind: 'error' }
	}
}

watch(() => props.raw, (raw) => {
	if (timer) clearTimeout(timer)
	const text = (raw ?? '').trim()
	if (text === '') {
		// Nothing to resolve — cancel any in-flight result so a stale match can't
		// land under an emptied field.
		token++
		state.value = { kind: 'idle' }
		return
	}
	timer = setTimeout(() => check(text), DEBOUNCE_MS)
}, { immediate: true })

onBeforeUnmount(() => {
	if (timer) clearTimeout(timer)
})
</script>

<template>
	<p class="resolution" :class="`resolution--${state.kind}`">
		<template v-if="state.kind === 'idle'">
			&nbsp;
		</template>
		<template v-else-if="state.kind === 'checking'">
			Checking reference data…
		</template>
		<template v-else-if="state.kind === 'matched'">
			Matches {{ state.code }}
			<span v-if="state.model"> · {{ [state.manufacturer, state.model].filter(Boolean).join(' ') }}</span>
		</template>
		<template v-else-if="state.kind === 'unmatched'">
			No aircraft reference data match.
		</template>
		<template v-else-if="state.kind === 'noReference'">
			No aircraft reference data on this instance, so types cannot be matched.
		</template>
		<template v-else>
			Could not check the reference data.
		</template>
	</p>
</template>

<style scoped>
.resolution {
	margin: 4px 0 0;
	font-size: 0.85em;
	color: var(--color-text-maxcontrast);
	min-height: 1.2em;
}

.resolution--matched {
	color: var(--color-success-text, var(--color-success));
}

.resolution--unmatched,
.resolution--error {
	color: var(--color-warning-text, var(--color-warning));
}
</style>
