<script setup lang="ts">
/**
 * A doughnut beside its legend: the part-to-whole layout shared by cabin class
 * and manufacturers. The centre shows the largest segment's share; every slice
 * and every legend row drills into the log through its segment's `to`.
 */
import { computed } from 'vue'
import { RouterLink, useRouter, type RouteLocationRaw } from 'vue-router'
import type { ChartTheme } from '../../chartTheme.ts'
import DonutChart from './DonutChart.vue'

export interface BreakdownSegment {
	key: string
	label: string
	count: number
	color: string
	to: RouteLocationRaw
}

const props = defineProps<{
	theme: ChartTheme
	/** In legend order, which is also the slice order. */
	segments: BreakdownSegment[]
	/** Describes the chart for assistive technology, and captions its table. */
	summary: string
}>()

const router = useRouter()

const total = computed(() => props.segments.reduce((sum, s) => sum + s.count, 0))
const largest = computed(() => [...props.segments].sort((a, b) => b.count - a.count)[0] ?? null)
</script>

<template>
	<div v-if="largest" class="breakdown">
		<DonutChart :theme="theme"
			:segments="segments"
			:summary="summary"
			:center-value="`${Math.round((largest.count / total) * 100)}%`"
			:center-label="largest.label"
			clickable
			@select="(i: number) => router.push(segments[i].to)" />
		<ul class="breakdown__legend">
			<li v-for="s in segments" :key="s.key">
				<RouterLink :to="s.to" class="breakdown__row">
					<span class="breakdown__swatch" :style="{ background: s.color }" />
					<span class="breakdown__label">{{ s.label }}</span>
					<span class="breakdown__count">{{ s.count }}</span>
				</RouterLink>
			</li>
		</ul>
	</div>
</template>

<style scoped>
.breakdown {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	/* Ring and legend sit together in the middle of the box, so the counts stay
	   next to their labels instead of at the far edge. */
	justify-content: center;
	gap: 24px;
}

.breakdown__legend {
	flex: 0 1 240px;
	min-width: 0;
	margin: 0;
	padding: 0;
	list-style: none;
}

.breakdown__row {
	display: flex;
	align-items: center;
	gap: 8px;
	min-height: 36px;
	padding: 0 8px;
	border-radius: var(--border-radius-element, 8px);
	color: var(--color-main-text);
}

.breakdown__row:hover,
.breakdown__row:focus-visible {
	background: var(--color-background-hover);
}

.breakdown__swatch {
	flex: none;
	width: 10px;
	height: 10px;
	border-radius: 2px;
}

.breakdown__label {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.breakdown__count {
	font-variant-numeric: tabular-nums;
}
</style>
