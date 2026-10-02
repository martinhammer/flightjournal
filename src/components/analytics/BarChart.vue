<script setup lang="ts">
/**
 * A themed single-series bar or column chart, in the theme's primary.
 *
 * Every bar is labelled with its value, so the value axis is hidden. Where
 * columns are too narrow for their labels to sit side by side (a phone), the
 * labels give way to a value axis with gridlines rather than overlap. A
 * visually hidden table carries the same data for screen readers, since a
 * canvas is opaque to them.
 *
 * When `clickable`, a click anywhere in a non-empty bar's column emits
 * `select` with its index; the parent decides where that drills to.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Bar } from 'vue-chartjs'
import type { ActiveElement, ChartData, ChartEvent, ChartOptions, TooltipItem } from 'chart.js'
import { valueLabels } from '../../chartPlugins.ts'
import { baseChartOptions, type ChartTheme } from '../../chartTheme.ts'

const props = withDefaults(defineProps<{
	theme: ChartTheme
	labels: string[]
	values: number[]
	/** What a value counts ("Flights"); heads the table's value column. */
	name: string
	/** Describes the chart for assistive technology, and captions its table. */
	summary: string
	format(value: number): string
	horizontal?: boolean
	/** Plot height in px, including the category axis. */
	height?: number
	/** Expands a category label for the tooltip title ("Mar" → "March 2025"). */
	tooltipTitle?: (index: number) => string
	/** Bars drill through: pointer cursor, a tooltip hint, `select` on click. */
	clickable?: boolean
}>(), {
	horizontal: false,
	height: 240,
	tooltipTitle: undefined,
	clickable: false,
})

const emit = defineEmits<{ select: [index: number] }>()

// Whether the bar at `index` has flights to drill into.
const drillable = (index: number | undefined): index is number => props.clickable && index !== undefined && !!props.values[index]

const data = computed<ChartData<'bar'>>(() => ({
	labels: props.labels,
	datasets: [{
		label: props.name,
		data: props.values,
		backgroundColor: props.theme.primary,
		// Full strength under the pointer, softened otherwise.
		hoverBackgroundColor: props.theme.primarySolid,
		borderWidth: 0,
		borderSkipped: 'start',
		borderRadius: 4,
		maxBarThickness: 24,
	}],
}))

const root = ref<HTMLElement | null>(null)
const width = ref(0)
const resize = typeof ResizeObserver === 'undefined'
	? null
	: new ResizeObserver(([entry]) => { width.value = entry.contentRect.width })
onMounted(() => { if (root.value) resize?.observe(root.value) })
onBeforeUnmount(() => resize?.disconnect())

// Column labels sit side by side, so each must fit its column's slot.
// 7px per character approximates 12px digits; unknown width counts as fitting.
const LABEL_CHAR_PX = 7
const labelsFit = computed(() => {
	if (props.horizontal || width.value === 0 || props.labels.length === 0) return true
	const longest = Math.max(...props.values.map((v) => props.format(v).length))
	return longest * LABEL_CHAR_PX + 6 <= width.value / props.labels.length
})

const options = computed<ChartOptions<'bar'>>(() => {
	const base = baseChartOptions(props.theme)
	const category = props.horizontal ? 'y' : 'x'
	const value = props.horizontal ? 'x' : 'y'
	return {
		...base,
		indexAxis: category,
		// Hover, tooltip and click all respond anywhere in a bar's band. `index`
		// mode searches along x unless told otherwise, which on horizontal bars
		// compares the pointer with the bar *ends* and picks the wrong row.
		interaction: { mode: 'index', intersect: false, axis: category },
		onClick: (_event: ChartEvent, elements: ActiveElement[]) => {
			const index = elements[0]?.index
			if (drillable(index)) emit('select', index)
		},
		onHover: (event: ChartEvent, elements: ActiveElement[]) => {
			const canvas = event.native?.target as HTMLElement | undefined
			if (canvas) canvas.style.cursor = drillable(elements[0]?.index) ? 'pointer' : 'default'
		},
		// Room past the bar ends for the value labels.
		layout: { padding: !labelsFit.value ? 0 : props.horizontal ? { right: 56 } : { top: 20 } },
		scales: {
			[category]: {
				...base.scales!.x,
				grid: { display: false },
			},
			[value]: {
				...base.scales!.y,
				beginAtZero: true,
				display: !labelsFit.value,
				border: { display: false },
				ticks: { ...base.scales!.y!.ticks, maxTicksLimit: 5, precision: 0, callback: (v: number | string) => props.format(Number(v)) },
			},
		},
		plugins: {
			...base.plugins,
			tooltip: {
				...base.plugins!.tooltip,
				// One series: a colour key in the box would say nothing.
				displayColors: false,
				callbacks: {
					title: (items: TooltipItem<'bar'>[]) => (props.tooltipTitle && items.length
						? props.tooltipTitle(items[0].dataIndex)
						: items[0]?.label ?? ''),
					label: (item: TooltipItem<'bar'>) => `${props.name}: ${props.format(Number(item.raw))}`,
					footer: (items: TooltipItem<'bar'>[]) => (drillable(items[0]?.dataIndex) ? 'Click to see these flights' : ''),
				},
			},
			fjValueLabels: {
				display: labelsFit.value,
				color: props.theme.text,
				font: props.theme.font,
				format: props.format,
			},
		},
	} as ChartOptions<'bar'>
})
</script>

<template>
	<div ref="root" class="bar-chart" :style="{ height: `${height}px` }">
		<Bar :data="data"
			:options="options"
			:plugins="[valueLabels]"
			:aria-label="summary" />
		<table class="hidden-visually">
			<caption>{{ summary }}</caption>
			<thead>
				<tr>
					<th scope="col" />
					<th scope="col">
						{{ name }}
					</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="(label, i) in labels" :key="label">
					<th scope="row">
						{{ tooltipTitle ? tooltipTitle(i) : label }}
					</th>
					<td>{{ format(values[i] ?? 0) }}</td>
				</tr>
			</tbody>
		</table>
	</div>
</template>

<style scoped>
.bar-chart {
	position: relative;
	min-width: 0;
}
</style>
