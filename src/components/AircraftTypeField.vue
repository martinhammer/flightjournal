<script setup lang="ts">
/**
 * The Aircraft type input: free text that gains a type-ahead over the reference
 * data, plus the feedback line showing what will be stored.
 *
 * Two ways in, deliberately:
 *
 *  - **Free text** — reconciliation resolves it on save, exactly as before. This
 *    is the fallback that must keep working when the instance has no aircraft
 *    reference data at all ("never block on enrichment"), so the control is a
 *    text field that *gains* suggestions, not a select that requires them.
 *  - **A pick** — sets `selection`, which the form sends as an explicit
 *    code + manufacturer + model. The backend honours those verbatim.
 *
 * Picking never touches the typed text. The reference values have their own
 * columns, so overwriting `aircraft_type_raw` would duplicate one string across
 * two columns and destroy the only record of what the user actually entered —
 * which is also what makes "fix all legs that say X" possible later.
 *
 * Editing the text clears an active pick: the pick described a different string,
 * and keeping it would silently save a type the user is no longer looking at.
 *
 * Standalone so a bulk-update dialog can mount the same control and get the same
 * `AircraftSelection` to apply across many flights.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import Close from 'vue-material-design-icons/Close.vue'
import { listAircraftTypes } from '../api.ts'
import AircraftResolution from './AircraftResolution.vue'
import { aircraftName, type AircraftType, type AircraftSelection } from '../types.ts'

const raw = defineModel<string | null>('raw', { required: true })
const selection = defineModel<AircraftSelection | null>('selection', { required: true })

const SUGGEST_LIMIT = 8
const DEBOUNCE_MS = 250

const suggestions = ref<AircraftType[]>([])
const open = ref(false)
const activeIndex = ref(-1)
const rootEl = ref<HTMLElement | null>(null)

let timer: ReturnType<typeof setTimeout> | null = null
// Guards against a slow early query landing after a newer one.
let token = 0

const label = (t: AircraftType) => aircraftName(t.manufacturer, t.model) ?? ''

const selectionLabel = computed(() => {
	const s = selection.value
	if (!s) return ''
	const name = aircraftName(s.manufacturer, s.model)
	return name ? `${s.code} · ${name}` : s.code
})

async function fetchSuggestions(term: string) {
	const mine = ++token
	try {
		const page = await listAircraftTypes(term, SUGGEST_LIMIT, 0, false)
		if (mine !== token) return
		suggestions.value = page.items
		open.value = page.items.length > 0
		activeIndex.value = -1
	} catch {
		if (mine !== token) return
		// A failed lookup just means no suggestions — the free-text path is
		// unaffected, so there is nothing to report here.
		suggestions.value = []
		open.value = false
	}
}

function onInput(value: string) {
	const text = value || null
	if (text !== raw.value) {
		// Any edit invalidates a pick made against the previous text.
		selection.value = null
	}
	raw.value = text

	if (timer) clearTimeout(timer)
	const term = (text ?? '').trim()
	if (term === '') {
		token++
		suggestions.value = []
		open.value = false
		return
	}
	timer = setTimeout(() => fetchSuggestions(term), DEBOUNCE_MS)
}

function choose(item: AircraftType) {
	selection.value = {
		code: item.icaoCode,
		manufacturer: item.manufacturer,
		model: item.model,
	}
	open.value = false
	activeIndex.value = -1
}

function clearSelection() {
	selection.value = null
}

function onKeydown(event: KeyboardEvent) {
	if (!open.value || suggestions.value.length === 0) return
	if (event.key === 'ArrowDown') {
		event.preventDefault()
		activeIndex.value = (activeIndex.value + 1) % suggestions.value.length
	} else if (event.key === 'ArrowUp') {
		event.preventDefault()
		activeIndex.value = activeIndex.value <= 0 ? suggestions.value.length - 1 : activeIndex.value - 1
	} else if (event.key === 'Enter') {
		if (activeIndex.value >= 0) {
			event.preventDefault()
			choose(suggestions.value[activeIndex.value])
		}
	} else if (event.key === 'Escape') {
		open.value = false
		activeIndex.value = -1
	}
}

function onDocumentPointerDown(event: PointerEvent) {
	if (!open.value) return
	const target = event.target as Node | null
	if (target && rootEl.value?.contains(target)) return
	open.value = false
}

watch(open, (isOpen) => {
	if (isOpen) {
		document.addEventListener('pointerdown', onDocumentPointerDown, true)
	} else {
		document.removeEventListener('pointerdown', onDocumentPointerDown, true)
	}
})

onBeforeUnmount(() => {
	if (timer) clearTimeout(timer)
	document.removeEventListener('pointerdown', onDocumentPointerDown, true)
})
</script>

<template>
	<div ref="rootEl" class="aircraft-field">
		<NcTextField
			label="Aircraft type"
			:model-value="raw ?? ''"
			autocomplete="off"
			@update:model-value="(v: string | number) => onInput(String(v))"
			@keydown="onKeydown" />

		<ul v-if="open" class="suggestions">
			<li v-for="(item, index) in suggestions" :key="item.id">
				<button
					type="button"
					class="suggestion"
					:class="{ 'suggestion--active': index === activeIndex }"
					@click="choose(item)">
					<span class="suggestion__code">{{ item.icaoCode }}</span>
					<span class="suggestion__name">{{ label(item) }}</span>
				</button>
			</li>
		</ul>

		<p v-if="selection" class="picked">
			Using {{ selectionLabel }}
			<NcButton variant="tertiary" :aria-label="'Clear the chosen aircraft type'" @click="clearSelection">
				<template #icon>
					<Close :size="16" />
				</template>
			</NcButton>
		</p>
		<AircraftResolution v-else :raw="raw" />
	</div>
</template>

<style scoped>
.aircraft-field {
	position: relative;
	display: flex;
	flex-direction: column;
}

.suggestions {
	position: absolute;
	z-index: 10;
	inset-block-start: 100%;
	inset-inline: 0;
	margin: 2px 0 0;
	padding: 4px;
	list-style: none;
	max-height: 260px;
	overflow-y: auto;
	background-color: var(--color-main-background);
	border: 1px solid var(--color-border);
	border-radius: var(--border-radius-large, var(--border-radius));
	box-shadow: 0 2px 8px var(--color-box-shadow);
}

.suggestion {
	display: flex;
	gap: 8px;
	align-items: baseline;
	width: 100%;
	padding: 6px 8px;
	border: none;
	border-radius: var(--border-radius);
	background: transparent;
	color: var(--color-main-text);
	text-align: start;
	cursor: pointer;
}

.suggestion:hover,
.suggestion--active {
	background-color: var(--color-background-hover);
}

.suggestion__code {
	min-width: 3.5em;
	font-weight: bold;
}

.suggestion__name {
	color: var(--color-text-maxcontrast);
}

.picked {
	display: flex;
	align-items: center;
	gap: 4px;
	margin: 4px 0 0;
	font-size: 0.85em;
	color: var(--color-text-maxcontrast);
	min-height: 1.2em;
}
</style>
