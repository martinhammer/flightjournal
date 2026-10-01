<script setup lang="ts">
/**
 * Read-only feedback under an origin/destination field: what the text currently
 * in the field resolves to against the airport reference data. The airport
 * counterpart of AircraftResolution — it re-resolves as you type, debounced,
 * against the server's resolver rather than guessing locally.
 *
 * Also reports its state to the parent (`update:kind`): the bulk editor needs
 * to know when the text will not resolve, because applying it then clears the
 * airport code and distance on every affected flight.
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { resolveAirport } from '../api.ts'
import type { ResolutionKind } from '../types.ts'

const props = defineProps<{ label: string | null }>()
const emit = defineEmits<{ 'update:kind': [kind: ResolutionKind] }>()

type State =
	| { kind: 'idle' }
	| { kind: 'checking' }
	| { kind: 'matched'; code: string | null; name: string | null }
	| { kind: 'unmatched' }
	| { kind: 'noReference' }
	| { kind: 'error' }

const state = ref<State>({ kind: 'idle' })

watch(() => state.value.kind, (kind) => emit('update:kind', kind))

const DEBOUNCE_MS = 300
let timer: ReturnType<typeof setTimeout> | null = null
// Guards against a slow early request overwriting a newer one's result.
let token = 0

async function check(text: string) {
	const mine = ++token
	state.value = { kind: 'checking' }
	try {
		const { match, referenceLoaded } = await resolveAirport(text)
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

watch(() => props.label, (label) => {
	if (timer) clearTimeout(timer)
	const text = (label ?? '').trim()
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
			Matches {{ [state.code, state.name].filter(Boolean).join(' · ') }}
		</template>
		<template v-else-if="state.kind === 'unmatched'">
			No airport reference data match.
		</template>
		<template v-else-if="state.kind === 'noReference'">
			No airport reference data on this instance, so airports cannot be matched.
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
