import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'

// Covers the view's wiring: the year picker and chips drive the route query,
// tiles and charts follow the filtered flights, and ranked rows link into the
// log with the right filter. Aggregation maths is covered in analytics.spec.ts;
// Chart.js itself does not render under jsdom, so vue-chartjs is stubbed and
// the test asserts what the view hands it.

const { store, push, routeHolder, getAirportsByCodes } = await vi.hoisted(async () => {
	const { reactive } = await import('vue')
	return {
		store: { flights: [] as unknown[], loaded: true, fetchAll: vi.fn() },
		push: vi.fn(),
		routeHolder: reactive({ query: {} as Record<string, string> }),
		getAirportsByCodes: vi.fn(),
	}
})

vi.mock('../../src/store/flights.ts', () => ({ useFlightsStore: () => store }))
vi.mock('../../src/api.ts', () => ({ getAirportsByCodes }))
vi.mock('vue-router', async (importOriginal) => ({
	...await importOriginal<typeof import('vue-router')>(),
	useRoute: () => routeHolder,
	useRouter: () => ({ push }),
}))
vi.mock('vue-chartjs', () => {
	const stub = (name: string) => ({
		name,
		props: ['data', 'options', 'plugins', 'ariaLabel'],
		template: `<canvas class="${name}" :aria-label="ariaLabel" />`,
	})
	return { Bar: stub('chart-bar'), Doughnut: stub('chart-doughnut'), PolarArea: stub('chart-polar'), Bubble: stub('chart-bubble') }
})

import AnalyticsView from '../../src/views/AnalyticsView.vue'
import { SLICE_LABEL_PADDING } from '../../src/chartPlugins.ts'
import { readChartTheme } from '../../src/chartTheme.ts'

let nextId = 1
function flight(overrides: Record<string, unknown> = {}) {
	return {
		id: nextId++,
		flightDate: '2025-03-03',
		daySeq: 1,
		originCode: 'LHR',
		destinationCode: 'DXB',
		originLabel: 'London Heathrow',
		destinationLabel: 'Dubai',
		airlineCode: 'EK',
		flightNumber: '2',
		aircraftTypeCode: 'B77W',
		aircraftTypeRaw: '77W',
		aircraftManufacturer: 'BOEING',
		aircraftModel: '777-300ER',
		registration: null,
		cabinClass: 'economy',
		seat: null,
		notes: null,
		distanceKm: 5470,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	}
}

const NcSelect = {
	name: 'NcSelect',
	props: ['modelValue', 'options'],
	emits: ['update:modelValue'],
	template: `<select class="period" :value="modelValue?.id" @change="$emit('update:modelValue', options.find((o) => o.id === $event.target.value) ?? null)">
		<option v-for="o in options" :key="o.id" :value="o.id">{{ o.label }}</option>
	</select>`,
}

const stubs = {
	NcSelect,
	NcChip: {
		props: ['text'],
		emits: ['close'],
		template: '<span class="chip">{{ text }}<button class="chip-close" @click="$emit(\'close\')" /></span>',
	},
	NcButton: { emits: ['click'], template: '<button class="nc-button" @click="$emit(\'click\')"><slot /></button>' },
	NcEmptyContent: { props: ['name'], template: '<div class="empty">{{ name }}</div>' },
	NcLoadingIcon: true,
	RouterLink: { props: ['to'], template: '<a class="link" :data-to="JSON.stringify(to)"><slot /></a>' },
}

async function render() {
	const wrapper = mount(AnalyticsView, { global: { stubs } })
	await flushPromises()
	return wrapper
}

const tile = (wrapper: Awaited<ReturnType<typeof render>>, label: string) => wrapper.findAll('.tile')
	.find((t) => t.find('.tile__label').text() === label)!

beforeEach(() => {
	push.mockClear()
	routeHolder.query = {}
	store.loaded = true
	store.flights = [
		flight({ flightDate: '2024-06-01' }),
		flight({ flightDate: '2025-03-03' }),
		flight({ flightDate: '2025-03-04', originCode: 'DXB', destinationCode: 'BKK', distanceKm: 4900, cabinClass: 'business' }),
		flight({ flightDate: '2025-07-01', airlineCode: 'BA', originCode: 'LHR', destinationCode: 'EDI', distanceKm: 534 }),
	]
	getAirportsByCodes.mockReset()
	getAirportsByCodes.mockResolvedValue([
		{ id: 1, iata: 'LHR', icao: 'EGLL', name: 'Heathrow', city: 'London', state: null, countryIso2: 'GB', lat: 0, lon: 0, elevation: null, tz: null, source: null, updatedAt: 0 },
		{ id: 2, iata: 'DXB', icao: 'OMDB', name: 'Dubai Intl', city: 'Dubai', state: null, countryIso2: 'AE', lat: 0, lon: 0, elevation: null, tz: null, source: null, updatedAt: 0 },
	])
})

describe('AnalyticsView', () => {
	it('summarises every flight when no period is chosen', async () => {
		const wrapper = await render()
		expect(tile(wrapper, 'Flights').find('.tile__value').text()).toBe('4')
		expect(tile(wrapper, 'Airlines').find('.tile__value').text()).toBe('2')
		// Countries come from the reference rows: GB and AE resolved, BKK/EDI not.
		expect(tile(wrapper, 'Countries').find('.tile__value').text()).toBe('2')
		expect(getAirportsByCodes).toHaveBeenCalledWith(expect.arrayContaining(['LHR', 'DXB', 'BKK', 'EDI']))
		expect(wrapper.find('.tile__delta').exists()).toBe(false)
	})

	it('picks a year as a whole-year date filter, keeping other filters', async () => {
		routeHolder.query = { airline: 'EK' }
		const wrapper = await render()
		const select = wrapper.find('select.period')
		expect(select.findAll('option').map((o) => o.text())).toEqual([
			'All years (3 flights)', '2025 (2 flights)', '2024 (1 flight)',
		])
		await select.setValue('2025')
		expect(push).toHaveBeenCalledWith({
			name: 'analytics',
			query: { airline: 'EK', dateFrom: '2025-01-01', dateTo: '2025-12-31' },
		})
	})

	it('clears the period with "All years"', async () => {
		routeHolder.query = { dateFrom: '2025-01-01', dateTo: '2025-12-31' }
		const wrapper = await render()
		await wrapper.find('select.period').setValue('all')
		expect(push).toHaveBeenCalledWith({ name: 'analytics', query: {} })
	})

	it('shows the year in the picker instead of a date chip, but keeps a custom range\'s chip', async () => {
		routeHolder.query = { dateFrom: '2025-01-01', dateTo: '2025-12-31' }
		const wrapper = await render()
		expect(wrapper.findAll('.chip')).toHaveLength(0)
		expect((wrapper.find('select.period').element as HTMLSelectElement).value).toBe('2025')

		routeHolder.query = { dateFrom: '2025-03-01', dateTo: '2025-03-31' }
		await nextTick()
		expect(wrapper.findAll('.chip').map((c) => c.text())).toEqual(['2025-03-01 → 2025-03-31'])
		expect((wrapper.find('select.period').element as HTMLSelectElement).value).toBe('custom')
	})

	it('compares a chosen year with the one before', async () => {
		routeHolder.query = { dateFrom: '2025-01-01', dateTo: '2025-12-31' }
		const wrapper = await render()
		expect(tile(wrapper, 'Flights').find('.tile__value').text()).toBe('3')
		expect(tile(wrapper, 'Flights').find('.tile__delta').text()).toBe('+200% vs 2024')
	})

	it('clears a filter from its chip, staying on Analytics', async () => {
		routeHolder.query = { airline: 'EK', cabin: 'business' }
		const wrapper = await render()
		const chip = wrapper.findAll('.chip').find((c) => c.text().startsWith('Airline'))!
		await chip.find('.chip-close').trigger('click')
		expect(push).toHaveBeenCalledWith({ name: 'analytics', query: { cabin: 'business' } })
	})

	it('links ranked rows into the log with their own filter added', async () => {
		routeHolder.query = { dateFrom: '2025-01-01', dateTo: '2025-12-31' }
		const wrapper = await render()
		const links = wrapper.findAll('a.link').map((a) => JSON.parse(a.attributes('data-to')!))
		const period = { dateFrom: '2025-01-01', dateTo: '2025-12-31' }
		expect(links).toContainEqual({ name: 'flights', query: { ...period, airline: 'EK' } })
		expect(links).toContainEqual({ name: 'flights', query: { ...period, airport: 'DXB', airportDir: 'either' } })
		expect(links).toContainEqual({ name: 'flights', query: { ...period, aircraft: 'BOEING 777-300ER' } })
		expect(links).toContainEqual({ name: 'flights', query: { ...period, cabin: 'business' } })
	})

	it('carries the filters to the log and the map', async () => {
		routeHolder.query = { airline: 'EK' }
		const wrapper = await render()
		const buttons = wrapper.findAll('.nc-button')
		await buttons.find((b) => b.text() === 'View in log')!.trigger('click')
		await buttons.find((b) => b.text() === 'View on map')!.trigger('click')
		expect(push).toHaveBeenNthCalledWith(1, { name: 'flights', query: { airline: 'EK' } })
		expect(push).toHaveBeenNthCalledWith(2, { name: 'map', query: { airline: 'EK' } })
	})

	it('draws flights per month as one softened series, solid under the pointer', async () => {
		routeHolder.query = { dateFrom: '2025-01-01', dateTo: '2025-12-31' }
		const wrapper = await render()
		const chart = wrapper.findAllComponents({ name: 'chart-bar' })
			.find((c) => c.props('ariaLabel') === 'Flights per month')!
		const data = chart.props('data')
		expect(data.labels).toHaveLength(12)
		expect(data.datasets).toHaveLength(1)
		// March: two legs; July: one.
		expect(data.datasets[0].data[2]).toBe(2)
		expect(data.datasets[0].data[6]).toBe(1)
		const { backgroundColor, hoverBackgroundColor } = data.datasets[0]
		expect(backgroundColor).toMatch(/^#[0-9a-f]{6}$/)
		expect(hoverBackgroundColor).toMatch(/^#[0-9a-f]{6}$/)
		expect(backgroundColor).not.toBe(hoverBackgroundColor)
		// Tooltips follow the pointer.
		expect(chart.props('options').plugins.tooltip.position).toBe('cursor')
	})

	it('names airports by code and place in one line, without a badge', async () => {
		const wrapper = await render()
		const rows = wrapper.findAll('.ranked__label').map((l) => l.text())
		expect(rows).toContain('DXB · Dubai')
		expect(rows).toContain('BKK')
		expect(wrapper.find('.ranked__badge').exists()).toBe(false)
	})

	it('gives the most-flown airport its country, like every other row', async () => {
		const wrapper = await render()
		const lhr = wrapper.findAll('.ranked__text').find((t) => t.text().startsWith('LHR'))!
		expect(lhr.find('.ranked__detail').text()).toBe('GB')
		expect(wrapper.text()).not.toContain('home')
	})

	describe('drill-through from the charts', () => {
		// Click a chart element the way Chart.js reports it: onClick(event, elements).
		async function clickChart(label: string, index: number) {
			const wrapper = await render()
			const chart = ['chart-bar', 'chart-doughnut', 'chart-polar', 'chart-bubble'].flatMap((name) => wrapper.findAllComponents({ name }))
				.find((c) => c.props('ariaLabel') === label)!
			chart.props('options').onClick({}, [{ index }])
			await nextTick()
			return chart
		}

		it('opens a month as a date range', async () => {
			routeHolder.query = { dateFrom: '2025-01-01', dateTo: '2025-12-31', airline: 'EK' }
			await clickChart('Flights per month', 2)
			expect(push).toHaveBeenCalledWith({ name: 'flights', query: { airline: 'EK', dateFrom: '2025-03-01', dateTo: '2025-03-31' } })
		})

		it('opens a year from the distance chart', async () => {
			await clickChart('Kilometres flown per year', 1)
			expect(push).toHaveBeenCalledWith({ name: 'flights', query: { dateFrom: '2025-01-01', dateTo: '2025-12-31' } })
		})

		it('opens a weekday', async () => {
			await clickChart('Flights by day of week', 0)
			expect(push).toHaveBeenCalledWith({ name: 'flights', query: { weekday: 'mon' } })
		})

		it('opens a distance bin, replacing any distance filter already set', async () => {
			routeHolder.query = { distanceMax: '99999' }
			// Index 1 is 500–1,000 km; LHR→EDI (534 km) is in it.
			await clickChart('Flights by great-circle distance', 1)
			expect(push).toHaveBeenCalledWith({ name: 'flights', query: { distanceMin: '500', distanceMax: '1000' } })
		})

		it('picks the bar in the row under the pointer on horizontal charts', async () => {
			// `index` mode searches along x by default, which on horizontal bars
			// matches the pointer against bar ends and lights up the wrong row.
			const distance = await clickChart('Flights by great-circle distance', 1)
			expect(distance.props('options').interaction).toMatchObject({ mode: 'index', intersect: false, axis: 'y' })
			const period = await clickChart('Flights per year', 0)
			expect(period.props('options').interaction.axis).toBe('x')
		})

		it('does nothing for an empty bar', async () => {
			await clickChart('Flights by great-circle distance', 0)
			expect(push).not.toHaveBeenCalled()
		})

		it('opens a cabin class from its slice', async () => {
			// Slices follow the legend: Economy, then Business.
			await clickChart('Flights by cabin class', 1)
			expect(push).toHaveBeenCalledWith({ name: 'flights', query: { cabin: 'business' } })
		})

		it('shows a plain swatch in the slice colour in the cabin tooltip', async () => {
			const chart = await clickChart('Flights by cabin class', 0)
			const { tooltip } = chart.props('options').plugins
			const fill = chart.props('data').datasets[0].backgroundColor[1]
			expect(tooltip.multiKeyBackground).toBe('transparent')
			expect(tooltip.callbacks.labelColor({ dataIndex: 1 })).toEqual({ borderColor: fill, backgroundColor: fill, borderRadius: 2 })
		})

		it('draws days of week as a polar chart shaded by value', async () => {
			const chart = await clickChart('Flights by day of week', 0)
			const { datasets } = chart.props('data')
			// Fixture: Mon 1, Tue 2, Sat 1 — Tuesday strongest, the empty days faintest.
			expect(datasets[0].data).toEqual([1, 2, 0, 0, 0, 1, 0])
			const [mon, tue, wed] = datasets[0].backgroundColor
			expect(new Set([mon, tue, wed]).size).toBe(3)
			expect(chart.props('options').plugins.fjSliceLabels.display).toBe(true)
			// Room for a label straight below the ring: its anchor 12px out, then
			// half of its 14px line.
			const { padding } = chart.props('options').layout
			expect(padding.bottom).toBe(SLICE_LABEL_PADDING.vertical)
			expect(padding.bottom).toBeGreaterThanOrEqual(12 + 7)
		})

		it('lists the top routes by number of flights like airlines and airports, each a link', async () => {
			const wrapper = await render()
			const list = wrapper.find('ol[aria-label="Most-flown routes by number of flights"]')
			// Fixture: LHR↔DXB twice; ties then go to the longer route.
			expect(list.findAll('.ranked__label').map((l) => l.text())).toEqual(['DXB ↔ LHR', 'BKK ↔ DXB', 'EDI ↔ LHR'])
			expect(list.findAll('.ranked__count').map((c) => c.text())).toEqual(['2', '1', '1'])
			expect(JSON.parse(list.find('a.link').attributes('data-to')!))
				.toEqual({ name: 'flights', query: { routeA: 'DXB', routeB: 'LHR', routeDir: 'both' } })
		})

		it('shows six routes like the other ranked lists, but eight bubbles', async () => {
			store.flights = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH', 'III']
				.flatMap((code, i) => Array.from({ length: 9 - i }, () => flight({ originCode: 'ZZZ', destinationCode: code, distanceKm: 1000 + i })))
			const wrapper = await render()
			expect(wrapper.findAll('ol[aria-label="Most-flown routes by number of flights"] li')).toHaveLength(6)
			expect(wrapper.findAll('ol[aria-label="Airlines by flights"] li').length).toBeLessThanOrEqual(6)
			const bubbles = wrapper.findAllComponents({ name: 'chart-bubble' })[0]
			expect(bubbles.props('data').datasets[0].data).toHaveLength(8)
			// The section heading carries no route count.
			expect(wrapper.find('#fj-routes').element.parentElement!.textContent!.trim()).toBe('Top routes')
		})

		it('ranks the second bubble chart by distance flown, labelling each bubble with it', async () => {
			const route = (o: string, d: string, km: number, n: number) => Array.from({ length: n }, () => flight({ originCode: o, destinationCode: d, distanceKm: km }))
			store.flights = [...route('FRA', 'LHR', 650, 5), ...route('FRA', 'SYD', 16500, 1), ...route('FRA', 'DXB', 4800, 2)]
			const chart = await clickChart('Routes with the most distance flown, by distance and number of flights', 0)
			const points = chart.props('data').datasets[0].data
			// 16,500 × 1 > 4,800 × 2 > 650 × 5: the single long haul leads.
			expect(points.map((p: { x: number, v: number, t: string }) => [p.x, p.v, p.t])).toEqual([
				[16500, 1, '16.5K km'], [4800, 2, '9.6K km'], [650, 5, '3.3K km'],
			])
			// Row 0 sits at the top.
			expect(points.map((p: { y: number }) => p.y)).toEqual([2, 1, 0])
			// Tooltip and click only over a bubble (with a little slack), not its whole row.
			expect(chart.props('options').interaction).toEqual({ mode: 'nearest', intersect: true })
			expect(chart.props('data').datasets[0].hitRadius).toBeGreaterThan(0)
			// Bubble area, not radius, is proportional to the number of flights.
			// (1, 2 and 5 flights: twice and five times the first bubble's area.)
			expect((points[1].r / points[0].r) ** 2).toBeCloseTo(2)
			expect((points[2].r / points[0].r) ** 2).toBeCloseTo(5)
			// The ticks Chart.js will draw — one per row, on the row — and their labels.
			const y = chart.props('options').scales.y
			const scale = { ticks: [{ value: -0.5 }, { value: 0.5 }] }
			y.afterBuildTicks(scale)
			expect(scale.ticks.map((t) => t.value)).toEqual([0, 1, 2])
			expect(scale.ticks.map((t) => y.ticks.callback(t.value))).toEqual(['FRA ↔ LHR', 'DXB ↔ FRA', 'FRA ↔ SYD'])
			expect(push).toHaveBeenCalledWith({ name: 'flights', query: { routeA: 'FRA', routeB: 'SYD', routeDir: 'both' } })
		})

		it('hints that a bar is clickable', async () => {
			const chart = await clickChart('Flights by day of week', 0)
			const footer = chart.props('options').plugins.tooltip.callbacks.footer
			expect(footer([{ dataIndex: 0 }])).toBe('Click to see these flights')
			// No flights on a Wednesday in the fixture.
			expect(footer([{ dataIndex: 2 }])).toBe('')
		})

		it('links manufacturers into the log', async () => {
			const wrapper = await render()
			const links = wrapper.findAll('a.link').map((a) => JSON.parse(a.attributes('data-to')!))
			expect(links).toContainEqual({ name: 'flights', query: { manufacturer: 'BOEING' } })
		})
	})

	describe('manufacturers doughnut', () => {
		beforeEach(() => {
			const maker = (aircraftManufacturer: string | null, n: number) => Array.from({ length: n }, () => flight({ aircraftManufacturer }))
			store.flights = [
				...maker('AIRBUS', 5), ...maker('BOEING', 3), ...maker('EMBRAER', 2),
				...maker('ATR', 1), ...maker('BOMBARDIER', 1), ...maker(null, 2),
			]
		})

		const donut = (wrapper: Awaited<ReturnType<typeof render>>) => wrapper.findAllComponents({ name: 'chart-doughnut' })
			.find((c) => c.props('ariaLabel') === 'Flights by aircraft manufacturer')!

		it('names the top three and folds the rest into "Other"', async () => {
			const wrapper = await render()
			const data = donut(wrapper).props('data')
			expect(data.labels).toEqual(['AIRBUS', 'BOEING', 'EMBRAER', 'Other (2)'])
			expect(data.datasets[0].data).toEqual([5, 3, 2, 2])
			expect(wrapper.text()).toContain('12 of 14 flights with a known manufacturer.')
		})

		it('shades by rank, strongest first, with "Other" in neutral grey', async () => {
			const wrapper = await render()
			const [airbus, boeing, embraer, other] = donut(wrapper).props('data').datasets[0].backgroundColor
			expect(new Set([airbus, boeing, embraer, other]).size).toBe(4)
			const lightness = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16)
			// Light theme fallback: stronger = darker.
			expect(lightness(airbus)).toBeLessThan(lightness(boeing))
			expect(lightness(boeing)).toBeLessThan(lightness(embraer))
		})

		it('drills a named slice to its manufacturer and "Other" to all of the rest', async () => {
			const wrapper = await render()
			const options = donut(wrapper).props('options')
			options.onClick({}, [{ index: 1 }])
			options.onClick({}, [{ index: 3 }])
			expect(push).toHaveBeenNthCalledWith(1, { name: 'flights', query: { manufacturer: 'BOEING' } })
			expect(push).toHaveBeenNthCalledWith(2, { name: 'flights', query: { manufacturer: 'ATR,BOMBARDIER' } })
		})
	})

	it('lays the charts out in rows, routes and distance above airlines', async () => {
		const wrapper = await render()
		// Each two-column row as "Left | Right", prefixed by its shared heading when
		// it has one (as the per-period, Top routes and Aircraft rows do).
		const rows = wrapper.findAll('.grid').map((row) => {
			const cells = row.findAll(':scope > *').map((cell) => cell.find('h3, h4').text()).join(' | ')
			const shared = row.element.parentElement?.querySelector(':scope > .block__head h3')?.textContent?.trim()
			return shared ? `${shared}: ${cells}` : cells
		})
		expect(rows.slice(1)).toEqual([
			'Top routes: By number of flights | By distance flown',
			'Distance in context | Distance distribution',
			'Airlines | Airports',
			'Aircraft: Manufacturers | Types',
			'Cabin class | Days of week',
		])
	})

	it('gives every half of every two-column row a heading and a centred body', async () => {
		const wrapper = await render()
		const halves = wrapper.findAll('.grid > *')
		expect(halves).toHaveLength(12)
		for (const half of halves) {
			const children = half.findAll(':scope > *')
			// Heading first (a bare h3, or a head row with its count), then the body.
			expect(children[0].element.matches('h3, .block__head, .cell__head')).toBe(true)
			expect(children.slice(1).map((c) => c.classes())).toEqual([['cell__body']])
		}
	})

	it('draws every slice on the page from the one palette', async () => {
		store.flights = [
			...[1, 2, 3, 4, 5, 6, 7].map((d) => flight({ flightDate: `2025-03-0${d + 2}`, cabinClass: 'economy', aircraftManufacturer: 'AIRBUS' })),
			flight({ flightDate: '2025-03-03', cabinClass: 'business', aircraftManufacturer: 'BOEING' }),
			flight({ flightDate: '2025-03-03', cabinClass: 'first', aircraftManufacturer: 'EMBRAER' }),
			flight({ flightDate: '2025-03-04', cabinClass: 'other', aircraftManufacturer: 'ATR' }),
			flight({ flightDate: '2025-03-05', cabinClass: 'premium_economy', aircraftManufacturer: 'SAAB' }),
		]
		const wrapper = await render()
		const theme = readChartTheme()
		const allowed = new Set([...theme.palette, theme.neutral])
		const sliced = ['chart-doughnut', 'chart-polar'].flatMap((name) => wrapper.findAllComponents({ name }))
		expect(sliced).toHaveLength(3)
		for (const chart of sliced) {
			for (const color of chart.props('data').datasets[0].backgroundColor) expect(allowed).toContain(color)
			// Every sliced chart outlines its slices the same way.
			expect(chart.props('data').datasets[0].borderColor).toBe(theme.primarySolid)
		}
		// The same shade means the same step: First and the top manufacturer share it.
		const donuts = Object.fromEntries(sliced.map((c) => [c.props('ariaLabel'), c.props('data')]))
		const cabin = donuts['Flights by cabin class']
		const makers = donuts['Flights by aircraft manufacturer']
		expect(cabin.datasets[0].backgroundColor[cabin.labels.indexOf('First')]).toBe(theme.palette[4])
		expect(makers.datasets[0].backgroundColor[0]).toBe(theme.palette[4])
		expect(cabin.datasets[0].backgroundColor[cabin.labels.indexOf('Other')]).toBe(theme.neutral)
	})

	it('says so when the filters match nothing', async () => {
		routeHolder.query = { airline: 'ZZ' }
		const wrapper = await render()
		expect(wrapper.find('.empty').text()).toBe('No matching flights')
		expect(wrapper.find('.tiles').exists()).toBe(false)
	})

	it('has an empty state before any flight is logged', async () => {
		store.flights = []
		const wrapper = await render()
		expect(wrapper.find('.empty').text()).toBe('No flights yet')
		expect(getAirportsByCodes).not.toHaveBeenCalled()
	})
})
