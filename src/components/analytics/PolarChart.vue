<script setup lang="ts">
/**
 * A themed polar-area chart, one slice per category, matching tickbuddy's
 * "Days of week" in size and tones: radius and shade both follow the value
 * (fewest faintest, most strongest, in the page palette's steps), with a thin
 * solid outline and labels outside the ring.
 *
 * Each label carries its value ("Mon 34"), so no number is reachable only
 * through the tooltip; a visually hidden table carries the same data for
 * screen readers. When `clickable`, a slice click emits `select`.
 */
import { computed } from 'vue'
import { PolarArea } from 'vue-chartjs'
import type { ActiveElement, ChartData, ChartEvent, ChartOptions, TooltipItem } from 'chart.js'
import { SLICE_LABEL_PADDING, sliceLabels } from '../../chartPlugins.ts'
import type { ChartTheme } from '../../chartTheme.ts'

const props = withDefaults(defineProps<{
	theme: ChartTheme
	labels: string[]
	values: number[]
	/** What a value counts ("Flights"); heads the table's value column. */
	name: string
	/** Describes the chart for assistive technology, and captions its table. */
	summary: string
	format(value: number): string
	/** Expands a label for the tooltip title ("Mon" → "Monday"). */
	tooltipTitle?: (index: number) => string
	/** Slices drill through: pointer cursor, a tooltip hint, `select` on click. */
	clickable?: boolean
	/** Height in px, including the labels around the ring. */
	height?: number
}>(), {
	tooltipTitle: undefined,
	clickable: false,
	height: 260,
})

const emit = defineEmits<{ select: [index: number] }>()

const drillable = (index: number | undefined): index is number => props.clickable && index !== undefined && !!props.values[index]

// Shade by value across the range actually shown, as tickbuddy does, but in
// the page palette's five steps rather than a continuous scale, so a slice here
// shares its shades with the doughnuts.
const colors = computed(() => {
	const { palette } = props.theme
	const min = Math.min(...props.values)
	const max = Math.max(...props.values)
	return props.values.map((v) => {
		const t = max === min ? 0.5 : (v - min) / (max - min)
		return palette[Math.round(t * (palette.length - 1))]
	})
})

const data = computed<ChartData<'polarArea'>>(() => ({
	labels: props.labels,
	datasets: [{
		label: props.name,
		data: props.values,
		backgroundColor: colors.value,
		hoverBackgroundColor: colors.value,
		borderColor: props.theme.primarySolid,
		hoverBorderColor: props.theme.primarySolid,
		borderWidth: 1,
	}],
}))

const options = computed<ChartOptions<'polarArea'>>(() => ({
	responsive: true,
	maintainAspectRatio: false,
	animation: false,
	// Room around the ring for the labels, from the same constants they are
	// drawn with.
	layout: {
		padding: {
			top: SLICE_LABEL_PADDING.vertical,
			bottom: SLICE_LABEL_PADDING.vertical,
			left: SLICE_LABEL_PADDING.horizontal,
			right: SLICE_LABEL_PADDING.horizontal,
		},
	},
	scales: {
		r: {
			beginAtZero: true,
			ticks: { display: false },
			grid: { color: props.theme.grid },
			angleLines: { display: false },
			pointLabels: { display: false },
		},
	},
	onClick: (_event: ChartEvent, elements: ActiveElement[]) => {
		const index = elements[0]?.index
		if (drillable(index)) emit('select', index)
	},
	onHover: (event: ChartEvent, elements: ActiveElement[]) => {
		const canvas = event.native?.target as HTMLElement | undefined
		if (canvas) canvas.style.cursor = drillable(elements[0]?.index) ? 'pointer' : 'default'
	},
	plugins: {
		legend: { display: false },
		tooltip: {
			position: 'cursor',
			caretPadding: 8,
			titleFont: { family: props.theme.font },
			bodyFont: { family: props.theme.font },
			footerFont: { family: props.theme.font, weight: 'normal' },
			// The same plain swatch as the doughnuts.
			multiKeyBackground: 'transparent',
			boxPadding: 4,
			callbacks: {
				title: (items: TooltipItem<'polarArea'>[]) => (props.tooltipTitle && items.length
					? props.tooltipTitle(items[0].dataIndex)
					: items[0]?.label ?? ''),
				label: (item: TooltipItem<'polarArea'>) => `${props.name}: ${props.format(Number(item.raw))}`,
				labelColor: (item: TooltipItem<'polarArea'>) => {
					const color = colors.value[item.dataIndex]
					return { borderColor: color, backgroundColor: color, borderRadius: 2 }
				},
				footer: (items: TooltipItem<'polarArea'>[]) => (drillable(items[0]?.dataIndex) ? 'Click to see these flights' : ''),
			},
		},
		fjSliceLabels: {
			display: true,
			color: props.theme.textMuted,
			valueColor: props.theme.text,
			font: props.theme.font,
			format: props.format,
		},
	},
}))
</script>

<template>
	<div class="polar-chart" :style="{ height: `${height}px` }">
		<PolarArea :data="data"
			:options="options"
			:plugins="[sliceLabels]"
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
.polar-chart {
	position: relative;
	min-width: 0;
}
</style>
