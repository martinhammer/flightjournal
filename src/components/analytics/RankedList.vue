<script setup lang="ts">
/**
 * A ranked list with proportional bars, in HTML rather than on a canvas: rows
 * need readable labels and real links into the filtered log.
 *
 * Single series, so every bar takes the primary colour; the unfilled track is
 * Nextcloud's own light step of the same hue.
 */
import { computed } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'

export interface RankedRow {
	key: string
	label: string
	count: number
	detail?: string
	/** Where the row links; rows without one are plain text. */
	to?: RouteLocationRaw
}

const props = withDefaults(defineProps<{
	rows: RankedRow[]
	limit?: number
	/** Accessible name for the list. */
	name: string
}>(), {
	limit: 6,
})

const shown = computed(() => props.rows.slice(0, props.limit))
const max = computed(() => Math.max(1, ...shown.value.map((r) => r.count)))
const width = (n: number) => `${Math.max(2, Math.round((n / max.value) * 100))}%`
</script>

<template>
	<ol class="ranked" :aria-label="name">
		<li v-for="row in shown" :key="row.key">
			<component :is="row.to ? RouterLink : 'div'"
				:to="row.to"
				class="ranked__row"
				:class="{ 'ranked__row--link': row.to }">
				<span class="ranked__body">
					<span class="ranked__text">
						<span class="ranked__label">{{ row.label }}</span>
						<span v-if="row.detail" class="ranked__detail">{{ row.detail }}</span>
					</span>
					<span class="ranked__track" aria-hidden="true">
						<span class="ranked__bar" :style="{ width: width(row.count) }" />
					</span>
				</span>
				<span class="ranked__count">{{ row.count }}</span>
			</component>
		</li>
	</ol>
</template>

<style scoped>
.ranked {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.ranked__row {
	display: flex;
	align-items: center;
	gap: 12px;
	min-height: 44px;
	padding: 2px 8px;
	border-radius: var(--border-radius-element, 8px);
	color: var(--color-main-text);
	text-decoration: none;
}

.ranked__row--link:hover,
.ranked__row--link:focus-visible {
	background: var(--color-background-hover);
}

.ranked__body {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 5px;
}

.ranked__text {
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.ranked__detail {
	margin-inline-start: 6px;
	color: var(--color-text-maxcontrast);
}

.ranked__track {
	display: block;
	height: 8px;
	border-radius: 4px;
	background: var(--color-primary-light);
}

.ranked__bar {
	display: block;
	height: 100%;
	border-radius: 4px;
	background: var(--fj-chart-primary, var(--color-primary-element));
}

.ranked__count {
	flex: none;
	min-width: 32px;
	text-align: end;
	font-variant-numeric: tabular-nums;
}
</style>
