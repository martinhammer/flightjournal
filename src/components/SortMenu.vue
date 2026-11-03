<script setup lang="ts" generic="K extends string">
import { computed } from 'vue'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import SortIcon from 'vue-material-design-icons/Sort.vue'

// The sort control for the card layout, where the header row (and its sort
// buttons) is hidden. It only reports the picked column: the view's own
// setSort decides the direction, so picking the active column again flips it
// exactly as a second click on its header does.

export interface SortColumn<T extends string> {
	key: T
	label: string
	/** Direction a first pick sorts in; default ascending. */
	defaultDir?: 'asc' | 'desc'
	/** Direction in words; default "A to Z" / "Z to A". */
	ascLabel?: string
	descLabel?: string
}

const props = defineProps<{
	columns: SortColumn<K>[]
	sortKey: K
	sortDir: 'asc' | 'desc'
}>()

const emit = defineEmits<{ sort: [key: K] }>()

function dirLabel(col: SortColumn<K>, dir: 'asc' | 'desc'): string {
	return dir === 'asc' ? col.ascLabel ?? 'A to Z' : col.descLabel ?? 'Z to A'
}

const active = computed(() => props.columns.find((c) => c.key === props.sortKey))
const menuName = computed(() => active.value ? `${active.value.label}, ${dirLabel(active.value, props.sortDir).toLowerCase()}` : 'Sort')
</script>

<template>
	<NcActions
		class="sort-menu"
		:menu-name="menuName"
		:aria-label="`Sort by ${menuName}`"
		variant="tertiary">
		<template #icon>
			<SortIcon :size="20" />
		</template>
		<NcActionButton
			v-for="col in columns"
			:key="col.key"
			type="radio"
			:model-value="sortKey"
			:value="col.key"
			:description="col.key === sortKey
				? `${dirLabel(col, sortDir)} · click again to reverse`
				: dirLabel(col, col.defaultDir ?? 'asc')"
			@click="emit('sort', col.key)">
			{{ col.label }}
		</NcActionButton>
	</NcActions>
</template>
