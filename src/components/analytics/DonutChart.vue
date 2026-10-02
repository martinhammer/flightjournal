<script setup lang="ts">
/**
 * A themed doughnut for part-to-whole at a glance (≤ 6 segments). The legend
 * and counts live in the parent's HTML; this draws the ring, a centre figure
 * and a visually hidden table. When `clickable`, a slice click emits `select`
 * with the segment's index.
 */
import { computed } from 'vue'
import { Doughnut } from 'vue-chartjs'
import type { ActiveElement, ChartData, ChartEvent, ChartOptions, TooltipItem } from 'chart.js'
import '../../chartPlugins.ts'
import type { ChartTheme } from '../../chartTheme.ts'

export interface DonutSegment {
	label: string
	count: number
	color: string
}

const props = defineProps<{
	theme: ChartTheme
	segments: DonutSegment[]
	summary: string
	centerValue: string
	centerLabel: string
	/** Slices drill through: pointer cursor, a tooltip hint, `select` on click. */
	clickable?: boolean
}>()

const emit = defineEmits<{ select: [index: number] }>()

const total = computed(() => props.segments.reduce((sum, s) => sum + s.count, 0))
const percent = (n: number) => (total.value ? Math.round((n / total.value) * 100) : 0)

const data = computed<ChartData<'doughnut'>>(() => ({
	labels: props.segments.map((s) => s.label),
	datasets: [{
		data: props.segments.map((s) => s.count),
		backgroundColor: props.segments.map((s) => s.color),
		hoverBackgroundColor: props.segments.map((s) => s.color),
		// A thin solid primary outline, as on the polar chart: the page
		// palette's pale steps rely on it to read as shapes.
		borderColor: props.theme.primarySolid,
		hoverBorderColor: props.theme.primarySolid,
		borderWidth: 1,
	}],
}))

const options = computed<ChartOptions<'doughnut'>>(() => ({
	responsive: true,
	maintainAspectRatio: false,
	animation: false,
	cutout: '68%',
	onClick: (_event: ChartEvent, elements: ActiveElement[]) => {
		const index = elements[0]?.index
		if (props.clickable && index !== undefined) emit('select', index)
	},
	onHover: (event: ChartEvent, elements: ActiveElement[]) => {
		const canvas = event.native?.target as HTMLElement | undefined
		if (canvas) canvas.style.cursor = props.clickable && elements.length ? 'pointer' : 'default'
	},
	plugins: {
		legend: { display: false },
		tooltip: {
			position: 'cursor',
			caretPadding: 8,
			titleFont: { family: props.theme.font },
			bodyFont: { family: props.theme.font },
			footerFont: { family: props.theme.font, weight: 'normal' },
			// A plain swatch in the slice's colour. By default Chart.js fills the
			// box with white (`multiKeyBackground`), outlines it in the slice's
			// border colour and insets the fill by 1px, which reads as a ring
			// around the swatch.
			multiKeyBackground: 'transparent',
			boxPadding: 4,
			callbacks: {
				labelColor: (item: TooltipItem<'doughnut'>) => {
					const color = props.segments[item.dataIndex].color
					return { borderColor: color, backgroundColor: color, borderRadius: 2 }
				},
				label: (item: TooltipItem<'doughnut'>) => `${item.label}: ${item.raw} (${percent(Number(item.raw))}%)`,
				footer: () => (props.clickable ? 'Click to see these flights' : ''),
			},
		},
	},
}))
</script>

<template>
	<div class="donut">
		<Doughnut :data="data" :options="options" :aria-label="summary" />
		<div class="donut__center" aria-hidden="true">
			<span class="donut__value">{{ centerValue }}</span>
			<span class="donut__label">{{ centerLabel }}</span>
		</div>
		<table class="hidden-visually">
			<caption>{{ summary }}</caption>
			<tbody>
				<tr v-for="s in segments" :key="s.label">
					<th scope="row">
						{{ s.label }}
					</th>
					<td>{{ s.count }}</td>
					<td>{{ percent(s.count) }}%</td>
				</tr>
			</tbody>
		</table>
	</div>
</template>

<style scoped>
.donut {
	position: relative;
	width: 160px;
	height: 160px;
	flex: none;
}

.donut__center {
	position: absolute;
	inset: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	pointer-events: none;
}

.donut__value {
	font-size: 24px;
	font-weight: 600;
	line-height: 1.1;
}

.donut__label {
	font-size: 12px;
	color: var(--color-text-maxcontrast);
}
</style>
