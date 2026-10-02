<script setup lang="ts">
/**
 * A themed bubble chart of ranked rows: one row per item, top-ranked at the
 * top, positioned along x by one measure and sized by another — the top
 * routes, by distance and number of flights.
 *
 * Bubble *area* is proportional to the value, so a route flown twice as often
 * looks twice the size (scaling the radius would exaggerate the big ones). The
 * value is also written beside each bubble, and a visually hidden table
 * carries everything for screen readers. When `clickable`, a click on a bubble
 * emits `select`; the tooltip likewise appears only over a bubble.
 */
import { computed } from 'vue'
import { Bubble } from 'vue-chartjs'
import type { ActiveElement, ChartData, ChartEvent, ChartOptions, TooltipItem } from 'chart.js'
import { bubbleLabels } from '../../chartPlugins.ts'
import { baseChartOptions, type ChartTheme } from '../../chartTheme.ts'

export interface BubbleRow {
	label: string
	/** Position along the x-axis. */
	x: number
	/** What the bubble's size encodes. */
	value: number
	/**
	 * Written beside the bubble instead of the formatted value — e.g. the
	 * measure the rows are ranked by, when that isn't the size.
	 */
	note?: string
}

const props = withDefaults(defineProps<{
	theme: ChartTheme
	/** Top-ranked first. */
	rows: BubbleRow[]
	/** Describes the chart for assistive technology, and captions its table. */
	summary: string
	/** Heads the table's x and value columns ("Distance", "Flights"). */
	xName: string
	valueName: string
	formatX(x: number): string
	formatValue(value: number): string
	/** Heads the table column for row notes, when the rows carry them. */
	noteName?: string
	/** Rows drill through: pointer cursor, a tooltip hint, `select` on click. */
	clickable?: boolean
}>(), {
	noteName: '',
	clickable: false,
})

const hasNotes = computed(() => props.rows.some((r) => r.note))

const emit = defineEmits<{ select: [index: number] }>()

/** Radius of the largest bubble, px; the smallest is never below MIN_RADIUS. */
const MAX_RADIUS = 14
const MIN_RADIUS = 3
/** Height of one row, px — room for the largest bubble with air around it. */
const ROW_HEIGHT = 35

const maxValue = computed(() => Math.max(1, ...props.rows.map((r) => r.value)))
const radius = (value: number) => Math.max(MIN_RADIUS, Math.sqrt(value / maxValue.value) * MAX_RADIUS)

// Row 0 at the top: y counts down from the number of rows.
const yOf = (i: number) => props.rows.length - 1 - i
const rowOf = (y: number) => props.rows.length - 1 - y

const height = computed(() => props.rows.length * ROW_HEIGHT + 48)

const data = computed<ChartData<'bubble'>>(() => ({
	datasets: [{
		label: props.valueName,
		data: props.rows.map((r, i) => ({ x: r.x, y: yOf(i), r: radius(r.value), v: r.value, t: r.note })),
		backgroundColor: props.theme.primary,
		hoverBackgroundColor: props.theme.primarySolid,
		// The same thin solid outline as the page's other palette-filled marks.
		borderColor: props.theme.primarySolid,
		hoverBorderColor: props.theme.primarySolid,
		borderWidth: 1,
		hoverBorderWidth: 1,
		hoverRadius: 0,
		// A few px of slack around each bubble, so the smallest ones (6px across)
		// are still easy to hover.
		hitRadius: 5,
	}],
}))

const options = computed<ChartOptions<'bubble'>>(() => {
	const base = baseChartOptions(props.theme)
	return {
		responsive: true,
		maintainAspectRatio: false,
		animation: false,
		font: base.font,
		color: base.color,
		// Room right of the farthest bubble for its label.
		layout: { padding: { right: hasNotes.value ? 56 : 32 } },
		// Only over a bubble (plus its hit radius): the tooltip, highlight and
		// click belong to the bubble, not to the empty rest of its row.
		interaction: { mode: 'nearest', intersect: true },
		scales: {
			x: {
				...base.scales!.x,
				type: 'linear',
				beginAtZero: true,
				// Keeps the farthest bubble clear of the edge.
				grace: '8%',
				border: { display: false },
				ticks: { ...base.scales!.x!.ticks, maxTicksLimit: 6, callback: (v: number | string) => props.formatX(Number(v)) },
			},
			y: {
				...base.scales!.y,
				type: 'linear',
				min: -0.5,
				max: props.rows.length - 0.5,
				grid: { display: false },
				border: { color: props.theme.grid },
				// One tick per row, on the row. Left to itself Chart.js counts from
				// the fixed `min`, putting every tick at -0.5, 0.5, 1.5 … — between
				// the rows, where there is no label to show.
				afterBuildTicks: (scale: { ticks: { value: number }[] }) => {
					scale.ticks = props.rows.map((_, i) => ({ value: i }))
				},
				ticks: {
					...base.scales!.y!.ticks,
					autoSkip: false,
					callback: (v: number | string) => props.rows[rowOf(Number(v))]?.label ?? '',
				},
			},
		},
		onClick: (_event: ChartEvent, elements: ActiveElement[]) => {
			const index = elements[0]?.index
			if (props.clickable && index !== undefined) emit('select', index)
		},
		onHover: (event: ChartEvent, elements: ActiveElement[]) => {
			const canvas = event.native?.target as HTMLElement | undefined
			if (canvas) canvas.style.cursor = props.clickable && elements.length ? 'pointer' : 'default'
		},
		plugins: {
			...base.plugins,
			tooltip: {
				...base.plugins!.tooltip,
				displayColors: false,
				callbacks: {
					title: (items: TooltipItem<'bubble'>[]) => props.rows[items[0]?.dataIndex]?.label ?? '',
					label: (item: TooltipItem<'bubble'>) => {
						const row = props.rows[item.dataIndex]
						const lines = [`${props.valueName}: ${props.formatValue(row.value)}`, `${props.xName}: ${props.formatX(row.x)}`]
						return row.note ? [...lines, `${props.noteName}: ${row.note}`] : lines
					},
					footer: () => (props.clickable ? 'Click to see these flights' : ''),
				},
			},
			fjBubbleLabels: {
				display: true,
				color: props.theme.text,
				font: props.theme.font,
				format: props.formatValue,
			},
		},
	} as ChartOptions<'bubble'>
})
</script>

<template>
	<div class="bubble-chart" :style="{ height: `${height}px` }">
		<Bubble :data="data"
			:options="options"
			:plugins="[bubbleLabels]"
			:aria-label="summary" />
		<table class="hidden-visually">
			<caption>{{ summary }}</caption>
			<thead>
				<tr>
					<th scope="col" />
					<th scope="col">
						{{ valueName }}
					</th>
					<th scope="col">
						{{ xName }}
					</th>
					<th v-if="hasNotes" scope="col">
						{{ noteName }}
					</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="row in rows" :key="row.label">
					<th scope="row">
						{{ row.label }}
					</th>
					<td>{{ formatValue(row.value) }}</td>
					<td>{{ formatX(row.x) }}</td>
					<td v-if="hasNotes">
						{{ row.note }}
					</td>
				</tr>
			</tbody>
		</table>
	</div>
</template>

<style scoped>
.bubble-chart {
	position: relative;
	min-width: 0;
}
</style>
