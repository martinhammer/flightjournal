/**
 * Chart.js registration and the one custom plugin the Analytics charts share.
 *
 * Only the pieces actually used are registered, keeping the lazy Analytics
 * chunk small.
 */
import {
	ArcElement,
	BarElement,
	CategoryScale,
	Chart,
	LinearScale,
	PointElement,
	RadialLinearScale,
	Tooltip,
	type ChartType,
	type Plugin,
	type TooltipPositionerFunction,
} from 'chart.js'

Chart.register(ArcElement, BarElement, CategoryScale, LinearScale, PointElement, RadialLinearScale, Tooltip)

// Tooltip position 'cursor': at the pointer, so the box tracks the mouse
// instead of sitting on a fixed point of the bar or slice. Chart.js re-runs the
// positioner on every pointer move and redraws when the result changes.
const cursor: TooltipPositionerFunction<ChartType> = (_elements, eventPosition) => (eventPosition
	? { x: eventPosition.x, y: eventPosition.y }
	: false)
Tooltip.positioners.cursor = cursor

export interface SliceLabelOptions {
	display: boolean
	/** Category name ("Mon"). */
	color: string
	/** The value beneath it. */
	valueColor: string
	font: string
	format: (value: number) => string
}

export interface ValueLabelOptions {
	display: boolean
	color: string
	font: string
	format: (value: number) => string
}

declare module 'chart.js' {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	interface PluginOptionsByType<TType extends ChartType> {
		fjValueLabels?: Partial<ValueLabelOptions>
		fjSliceLabels?: Partial<SliceLabelOptions>
		fjBubbleLabels?: Partial<ValueLabelOptions>
	}
	interface TooltipPositionerMap {
		cursor: TooltipPositionerFunction<ChartType>
	}
}

/**
 * Writes each bar's value just past the bar's end (a stack's total past its
 * outermost segment), so no number is reachable only through a hover tooltip.
 * Text uses the theme's text colour, never the series colour.
 */
export const valueLabels: Plugin<'bar'> = {
	id: 'fjValueLabels',
	afterDatasetsDraw(chart, _args, options: Partial<ValueLabelOptions>) {
		if (!options?.display || !options.format) return
		const horizontal = chart.options.indexAxis === 'y'
		const metas = chart.getSortedVisibleDatasetMetas()
		const count = chart.data.labels?.length ?? 0
		const { ctx } = chart
		ctx.save()
		ctx.fillStyle = options.color ?? '#222222'
		ctx.font = `12px ${options.font ?? 'sans-serif'}`
		ctx.textAlign = horizontal ? 'left' : 'center'
		ctx.textBaseline = horizontal ? 'middle' : 'bottom'
		for (let i = 0; i < count; i++) {
			let total = 0
			let x = horizontal ? -Infinity : 0
			let y = horizontal ? 0 : Infinity
			for (const meta of metas) {
				const value = Number(chart.data.datasets[meta.index].data[i] ?? 0)
				const bar = meta.data[i] as unknown as { x: number, y: number } | undefined
				if (!value || !bar) continue
				total += value
				// The outermost segment of a stack carries the label.
				if (horizontal ? bar.x > x : bar.y < y) {
					x = bar.x
					y = bar.y
				}
			}
			if (total === 0) continue
			if (horizontal) ctx.fillText(options.format(total), x + 6, y)
			else ctx.fillText(options.format(total), x, y - 4)
		}
		ctx.restore()
	},
}

/** Gap between the outer ring and a slice label's anchor, px (as tickbuddy). */
const SLICE_LABEL_GAP = 12
/** Height of the label's single 12px line, px. */
const SLICE_LABEL_LINE = 14
/** Width allowed for the widest expected label ("Wed 1,234"), px. */
const SLICE_LABEL_WIDTH = 64

/**
 * Layout padding a polar chart needs so its slice labels are never clipped:
 * vertically the gap plus the line (a label straight above or below the ring
 * is centred on its anchor), horizontally the gap plus a label's width — which
 * on a wide box costs nothing (the ring is height-bound) and on a narrow one
 * shrinks the ring rather than cutting labels off.
 */
export const SLICE_LABEL_PADDING = {
	vertical: SLICE_LABEL_GAP + SLICE_LABEL_LINE,
	horizontal: SLICE_LABEL_GAP + SLICE_LABEL_WIDTH,
}

/**
 * Polar-area labels: each slice's category just outside the outer ring, at the
 * slice's middle angle, followed by its value on the same line ("Mon 34") —
 * the polar chart's equivalent of a bar's value label. Name in the muted text
 * colour, value in the main one.
 */
export const sliceLabels: Plugin<'polarArea'> = {
	id: 'fjSliceLabels',
	afterDatasetsDraw(chart, _args, options: Partial<SliceLabelOptions>) {
		if (!options?.display || !options.format) return
		const scale = chart.scales.r as unknown as { xCenter: number, yCenter: number, drawingArea: number } | undefined
		if (!scale) return
		const meta = chart.getDatasetMeta(0)
		const labels = (chart.data.labels ?? []) as string[]
		const values = chart.data.datasets[0]?.data ?? []
		const radius = scale.drawingArea + SLICE_LABEL_GAP
		const nameFont = `12px ${options.font ?? 'sans-serif'}`
		const valueFont = `600 12px ${options.font ?? 'sans-serif'}`
		const { ctx } = chart
		ctx.save()
		ctx.textBaseline = 'middle'
		ctx.textAlign = 'left'
		for (let i = 0; i < meta.data.length; i++) {
			const arc = meta.data[i] as unknown as { startAngle: number, endAngle: number }
			const mid = (arc.startAngle + arc.endAngle) / 2
			const x = scale.xCenter + Math.cos(mid) * radius
			const y = scale.yCenter + Math.sin(mid) * radius
			const name = `${labels[i] ?? ''} `
			const value = options.format(Number(values[i] ?? 0))
			ctx.font = nameFont
			const nameWidth = ctx.measureText(name).width
			ctx.font = valueFont
			const width = nameWidth + ctx.measureText(value).width
			// Grow away from the ring: rightwards on the right, leftwards on the
			// left, centred at the top and bottom.
			const cos = Math.cos(mid)
			const left = cos > 0.1 ? x : cos < -0.1 ? x - width : x - width / 2
			ctx.font = nameFont
			ctx.fillStyle = options.color ?? '#6b6b6b'
			ctx.fillText(name, left, y)
			ctx.font = valueFont
			ctx.fillStyle = options.valueColor ?? '#222222'
			ctx.fillText(value, left + nameWidth, y)
		}
		ctx.restore()
	},
}

/**
 * Bubble labels: each bubble's value (its `v`, which its radius encodes) just
 * right of the bubble, so the count behind a size is never tooltip-only — or
 * its note (`t`) instead, when the chart labels a different measure.
 */
export const bubbleLabels: Plugin<'bubble'> = {
	id: 'fjBubbleLabels',
	afterDatasetsDraw(chart, _args, options: Partial<ValueLabelOptions>) {
		if (!options?.display || !options.format) return
		const meta = chart.getDatasetMeta(0)
		const points = chart.data.datasets[0]?.data ?? []
		const { ctx } = chart
		ctx.save()
		ctx.font = `12px ${options.font ?? 'sans-serif'}`
		ctx.fillStyle = options.color ?? '#222222'
		ctx.textAlign = 'left'
		ctx.textBaseline = 'middle'
		for (let i = 0; i < meta.data.length; i++) {
			const el = meta.data[i] as unknown as { x: number, y: number, options: { radius: number } }
			const point = points[i] as { v?: number, t?: string } | undefined
			const text = point?.t ?? (point?.v === undefined ? undefined : options.format(point.v))
			if (text === undefined) continue
			ctx.fillText(text, el.x + el.options.radius + 6, el.y)
		}
		ctx.restore()
	},
}
