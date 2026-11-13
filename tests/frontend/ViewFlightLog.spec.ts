import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'

// Covers the route-query-driven filtering and the removable filter chip.

// The route is reactive (as vue-router's is) so a query change mid-test drives
// the view's watchers — the selection clears on any filter change.
const { store, push, routeHolder } = await vi.hoisted(async () => {
	const { reactive } = await import('vue')
	return {
		store: {
			flights: [] as unknown[],
			loaded: true,
			loading: false,
			loadError: null as unknown,
			moving: false,
			fetchAll: vi.fn(),
			remove: vi.fn(),
			move: vi.fn(),
		},
		push: vi.fn(),
		routeHolder: reactive({ query: {} as Record<string, string> }),
	}
})

vi.mock('../../src/store/flights.ts', () => ({ useFlightsStore: () => store }))
vi.mock('vue-router', async (importOriginal) => ({
	...await importOriginal<typeof import('vue-router')>(),
	useRoute: () => routeHolder,
	useRouter: () => ({ push }),
}))

import { addFlightOpen } from '../../src/addFlight.ts'
import ViewFlightLog from '../../src/views/ViewFlightLog.vue'

function flight(id: number, originCode: string, destinationCode: string, distanceKm: number | null = null) {
	return {
		id,
		flightDate: `2026-01-0${id}`,
		originCode,
		destinationCode,
		originLabel: originCode,
		destinationLabel: destinationCode,
		airlineCode: null,
		flightNumber: null,
		aircraftTypeCode: null,
		aircraftTypeRaw: null,
		registration: null,
		cabinClass: null,
		seat: null,
		notes: null,
		distanceKm,
		createdAt: 0,
		updatedAt: 0,
	}
}

const NcChipStub = {
	name: 'NcChip',
	props: ['text'],
	emits: ['close'],
	template: '<span class="chip">{{ text }}<button class="chip-close" @click="$emit(\'close\')" /></span>',
}

const NcButtonStub = {
	name: 'NcButton',
	emits: ['click'],
	template: '<button class="nc-button" @click="$emit(\'click\')"><slot /></button>',
}

// Slot-rendering stubs so the per-row menu's action buttons are reachable.
const NcActions = { template: '<div class="row-menu"><slot /></div>' }
const NcActionButton = {
	emits: ['click'],
	template: '<button class="row-action" @click="$emit(\'click\')"><slot /></button>',
}

// Emits on click like the real switch, so a test's click — and its shiftKey —
// passes through the cell's capture listener exactly as in the browser.
const NcCheckboxRadioSwitch = {
	props: ['modelValue', 'indeterminate', 'ariaLabel'],
	emits: ['update:modelValue'],
	template: '<input type="checkbox" class="select-box" :checked="modelValue" :data-indeterminate="indeterminate" :aria-label="ariaLabel" @click="$emit(\'update:modelValue\', !modelValue)">',
}

// Exposes what the view hands the dialog, and lets a test emit its events.
const BulkEditDialog = {
	name: 'BulkEditDialog',
	props: ['open', 'flights'],
	emits: ['update:open', 'saved'],
	template: '<div v-if="open" class="bulk-dialog" :data-ids="flights.map((f) => f.id).join(\',\')" />',
}

const stubs = {
	NcCheckboxRadioSwitch,
	BulkEditDialog,
	Close: true,
	NcChip: NcChipStub,
	NcButton: NcButtonStub,
	NcEmptyContent: true,
	NcActions,
	NcActionButton,
	NcLoadingIcon: true,
	MenuUp: true,
	MenuDown: true,
	ChevronUp: true,
	ChevronDown: true,
	Pencil: true,
	TrashCan: true,
	Map: true,
	// FilterPicker is covered by its own spec; stub here to keep this file focused.
	FilterPicker: true,
}

function render(options: { attachTo?: HTMLElement } = {}) {
	return mount(ViewFlightLog, { global: { stubs }, ...options })
}

beforeEach(() => {
	push.mockClear()
	store.move.mockClear()
	store.fetchAll.mockReset()
	store.loaded = true
	store.loadError = null
	store.moving = false
	routeHolder.query = {}
	addFlightOpen.value = false
	// f1 LHR→JFK, f2 JFK→LHR, f3 CPH→LHR
	store.flights = [
		flight(1, 'LHR', 'JFK', 5555),
		flight(2, 'JFK', 'LHR', 5555),
		flight(3, 'CPH', 'LHR', 955),
	]
})

describe('ViewFlightLog filtering', () => {
	it('has no Add flight button in the table layout', () => {
		expect(render().find('.add-flight').exists()).toBe(false)
	})

	it('lists every flight when no filter is active', () => {
		const wrapper = render()
		expect(wrapper.findAll('tbody tr')).toHaveLength(3)
		expect(wrapper.find('.chip').exists()).toBe(false)
	})

	it('filters to arrivals with airportDir=to', () => {
		routeHolder.query = { airport: 'LHR', airportDir: 'to' }
		const wrapper = render()
		expect(wrapper.findAll('tbody tr')).toHaveLength(2)
	})

	it('filters to departures with airportDir=from', () => {
		routeHolder.query = { airport: 'LHR', airportDir: 'from' }
		const wrapper = render()
		expect(wrapper.findAll('tbody tr')).toHaveLength(1)
	})

	it('filters to both directions with airportDir=either', () => {
		routeHolder.query = { airport: 'LHR', airportDir: 'either' }
		const wrapper = render()
		expect(wrapper.findAll('tbody tr')).toHaveLength(3)
	})

	it('shows a chip for the active filter and clears it on close', async () => {
		routeHolder.query = { airport: 'LHR', airportDir: 'to' }
		const wrapper = render()
		expect(wrapper.find('.chip').text()).toContain('To LHR')

		await wrapper.find('.chip-close').trigger('click')
		expect(push).toHaveBeenCalledWith({ name: 'flights', query: {} })
	})

	it('shows how many flights the filter matches', () => {
		routeHolder.query = { airport: 'LHR', airportDir: 'to' }
		const wrapper = render()
		// Heading-level count: "<shown> of <total> flights" while a filter narrows.
		expect(wrapper.find('.filter-count').text()).toBe('2 of 3 flights')
	})

	it('shows just the total in the heading when no filter is active', () => {
		routeHolder.query = {}
		const wrapper = render()
		expect(wrapper.find('.filter-count').text()).toBe('3 flights')
	})

	it('carries the active filter to the Map view via "View on map"', async () => {
		routeHolder.query = { airport: 'LHR', airportDir: 'to' }
		const wrapper = render()
		await wrapper.find('.nc-button').trigger('click')
		expect(push).toHaveBeenCalledWith({
			name: 'map',
			query: { airport: 'LHR', airportDir: 'to' },
		})
	})

	it('carries the active filter to the Analytics view via "View analytics"', async () => {
		routeHolder.query = { airport: 'LHR', airportDir: 'to' }
		const wrapper = render()
		await wrapper.findAll('.nc-button').find((b) => b.text() === 'View analytics')!.trigger('click')
		expect(push).toHaveBeenCalledWith({
			name: 'analytics',
			query: { airport: 'LHR', airportDir: 'to' },
		})
	})

	it('shows no "View on map" button when no filter is active', () => {
		const wrapper = render()
		expect(wrapper.find('.nc-button').exists()).toBe(false)
	})

	it('opens the edit screen when a row is double-clicked, carrying the active filter', async () => {
		routeHolder.query = { airport: 'LHR', airportDir: 'to' }
		const wrapper = render()
		// Both LHR-arriving legs match; sorted date-desc the newest (f3, id 3) is first.
		await wrapper.findAll('tbody tr')[0].trigger('dblclick')
		expect(push).toHaveBeenCalledWith({
			path: '/flights/3/edit',
			query: { airport: 'LHR', airportDir: 'to' },
		})
	})

	it('does not open the edit screen when the reorder cell is double-clicked', async () => {
		const wrapper = render()
		await wrapper.findAll('tbody tr')[0].find('td.reorder').trigger('dblclick')
		expect(push).not.toHaveBeenCalled()
	})

	it('opens a single flight on the Map view from its row menu', async () => {
		const wrapper = render()
		// First row is the newest flight (sorted by date desc) — f3, id 3.
		// Row menu order: View on map, Edit, Delete.
		const firstRowActions = wrapper.findAll('tbody tr')[0].findAll('.row-action')
		await firstRowActions[0].trigger('click')
		expect(push).toHaveBeenCalledWith({ name: 'map', query: { flight: '3' } })
	})
})

describe('ViewFlightLog distance column', () => {
	// Distance cell is the 5th column (select, date, flight, route, distance, …).
	const distanceCells = (wrapper: ReturnType<typeof render>) =>
		wrapper.findAll('tbody tr').map((r) => r.findAll('td')[4].text().replace(/\D/g, ''))

	it('sorts numerically by distance, not lexically', async () => {
		const wrapper = render()
		const distanceHeader = wrapper.findAll('th .sort-button')[3]
		expect(distanceHeader.text()).toContain('Distance (km)')

		// First click uses the column's desc default → longest first.
		await distanceHeader.trigger('click')
		expect(distanceCells(wrapper)).toEqual(['5555', '5555', '955'])

		// Toggling flips to ascending → shortest first.
		await distanceHeader.trigger('click')
		expect(distanceCells(wrapper)).toEqual(['955', '5555', '5555'])
	})

	it('renders an empty cell when distance is unknown', () => {
		store.flights = [flight(1, 'AAA', 'BBB', null)]
		const wrapper = render()
		expect(wrapper.find('tbody tr td.numeric').text()).toBe('')
	})
})

describe('ViewFlightLog aircraft column', () => {
	// Aircraft is the 6th column (select, date, flight, route, distance, aircraft, …).
	const aircraftCell = (wrapper: ReturnType<typeof render>) =>
		wrapper.find('tbody tr').findAll('td')[5].text()

	it('shows the reference manufacturer and model, not the designator', () => {
		store.flights = [{
			...flight(1, 'LHR', 'JFK'),
			aircraftTypeCode: 'B738',
			aircraftTypeRaw: '738',
			aircraftManufacturer: 'BOEING',
			aircraftModel: '737-800',
		}]
		expect(aircraftCell(render())).toBe('BOEING 737-800')
	})

	/**
	 * The fallback chain matters as much as the happy path: a leg that never
	 * resolved must still show what the user typed rather than going blank.
	 */
	it('falls back to the typed text when nothing resolved', () => {
		store.flights = [{
			...flight(1, 'LHR', 'JFK'),
			aircraftTypeRaw: 'mystery jet',
		}]
		expect(aircraftCell(render())).toBe('mystery jet')
	})

	it('falls back to the designator when only a code is stored', () => {
		store.flights = [{
			...flight(1, 'LHR', 'JFK'),
			aircraftTypeCode: 'B738',
		}]
		expect(aircraftCell(render())).toBe('B738')
	})

	it('renders an empty cell when no aircraft was recorded', () => {
		store.flights = [flight(1, 'LHR', 'JFK')]
		expect(aircraftCell(render())).toBe('')
	})
})

describe('ViewFlightLog within-day reordering', () => {
	// Three legs on the same day, daySeq 1..3. Default sort is date desc, so the
	// rows read top→bottom as the latest leg first: seq 3, seq 2, seq 1.
	function sameDay(id: number, daySeq: number) {
		return { ...flight(id, 'AAA', 'BBB'), flightDate: '2026-03-15', daySeq }
	}

	const reorderButtons = (wrapper: ReturnType<typeof render>, rowIndex: number) =>
		wrapper.findAll('tbody tr')[rowIndex].findAll('td.reorder .nc-button')

	beforeEach(() => {
		store.flights = [sameDay(1, 1), sameDay(2, 2), sameDay(3, 3)]
	})

	it('shows no reorder chevrons when each day has a single leg', () => {
		// The default distinct-date fixture: one flight per day.
		store.flights = [flight(1, 'AAA', 'BBB'), flight(2, 'CCC', 'DDD')]
		const wrapper = render()
		expect(wrapper.findAll('td.reorder .nc-button')).toHaveLength(0)
	})

	it('renders up/down chevrons for a multi-leg day', () => {
		const wrapper = render()
		// Two chevrons per row × three rows.
		expect(wrapper.findAll('td.reorder .nc-button')).toHaveLength(6)
	})

	it('disables up on the top leg and down on the bottom leg', () => {
		const wrapper = render()
		// Row 0 is the latest leg (top): cannot move further up.
		expect(reorderButtons(wrapper, 0)[0].attributes('disabled')).toBeDefined()
		expect(reorderButtons(wrapper, 0)[1].attributes('disabled')).toBeUndefined()
		// Row 2 is the earliest leg (bottom): cannot move further down.
		expect(reorderButtons(wrapper, 2)[0].attributes('disabled')).toBeUndefined()
		expect(reorderButtons(wrapper, 2)[1].attributes('disabled')).toBeDefined()
	})

	it('moving a leg up sends "later" under newest-first sort', async () => {
		const wrapper = render()
		// Middle row is flight id 2 (seq 2). Up chevron → later in the day.
		await reorderButtons(wrapper, 1)[0].trigger('click')
		expect(store.move).toHaveBeenCalledWith(2, 'later')
	})

	it('moving a leg down sends "earlier" under newest-first sort', async () => {
		const wrapper = render()
		await reorderButtons(wrapper, 1)[1].trigger('click')
		expect(store.move).toHaveBeenCalledWith(2, 'earlier')
	})

	it('ignores a further move until the last one has been applied', async () => {
		// Until the refetch lands the rows on screen are not the day's real order,
		// so a second move would aim at the wrong neighbour.
		store.moving = true
		const wrapper = render()
		await reorderButtons(wrapper, 1)[0].trigger('click')
		await wrapper.findAll('tbody tr')[1].find('.row-action.move-up').trigger('click')
		expect(store.move).not.toHaveBeenCalled()
		// Ignored, not disabled: disabling would drop keyboard focus mid-reorder.
		expect(reorderButtons(wrapper, 1)[0].attributes('disabled')).toBeUndefined()
	})

	it('flips the chevron mapping when the date sort is ascending', async () => {
		const wrapper = render()
		// Toggle the Date column to ascending: now the earliest leg is on top.
		await wrapper.findAll('th .sort-button')[0].trigger('click')
		// Middle row is still id 2; up now means earlier in the day.
		await reorderButtons(wrapper, 1)[0].trigger('click')
		expect(store.move).toHaveBeenCalledWith(2, 'earlier')
	})

	it('hides chevrons while a filter is active', () => {
		routeHolder.query = { airport: 'AAA', airportDir: 'from' }
		const wrapper = render()
		expect(wrapper.findAll('td.reorder .nc-button')).toHaveLength(0)
	})
})

describe('ViewFlightLog row selection', () => {
	// Default sort is date desc, so rows read f3, f2, f1 top to bottom.
	const rowBoxes = (wrapper: ReturnType<typeof render>) => wrapper.findAll('tbody .select-box')
	const headerBox = (wrapper: ReturnType<typeof render>) => wrapper.find('thead .select-box')
	const selectedIds = (wrapper: ReturnType<typeof render>) =>
		wrapper.findAll('tbody tr').filter((r) => r.classes('selected')).map((r) => r.find('td:nth-child(2)').text())

	it('adds the selected count to the heading count', async () => {
		const wrapper = render()
		await rowBoxes(wrapper)[0].trigger('click')
		expect(wrapper.find('.filter-count').text()).toBe('3 flights · 1 selected')
	})

	it('keeps the filtered count format alongside the selection', async () => {
		routeHolder.query = { airport: 'LHR', airportDir: 'to' }
		const wrapper = render()
		await rowBoxes(wrapper)[0].trigger('click')
		expect(wrapper.find('.filter-count').text()).toBe('2 of 3 flights · 1 selected')
	})

	it('toggles a row off again', async () => {
		const wrapper = render()
		await rowBoxes(wrapper)[0].trigger('click')
		await rowBoxes(wrapper)[0].trigger('click')
		expect(wrapper.find('.filter-count').text()).toBe('3 flights')
	})

	it('selects the whole range on shift-click', async () => {
		const wrapper = render()
		await rowBoxes(wrapper)[0].trigger('click')
		await rowBoxes(wrapper)[2].trigger('click', { shiftKey: true })
		expect(selectedIds(wrapper)).toEqual(['2026-01-03', '2026-01-02', '2026-01-01'])
	})

	it('selects only the clicked row without shift', async () => {
		const wrapper = render()
		await rowBoxes(wrapper)[0].trigger('click')
		await rowBoxes(wrapper)[2].trigger('click')
		expect(selectedIds(wrapper)).toEqual(['2026-01-03', '2026-01-01'])
	})

	it('select-all selects only the visible rows, and toggles them off again', async () => {
		routeHolder.query = { airport: 'LHR', airportDir: 'to' }
		const wrapper = render()
		await headerBox(wrapper).trigger('click')
		expect(wrapper.find('.filter-count').text()).toBe('2 of 3 flights · 2 selected')

		await headerBox(wrapper).trigger('click')
		expect(wrapper.find('.filter-count').text()).toBe('2 of 3 flights')
	})

	it('marks the select-all box indeterminate on a partial selection', async () => {
		const wrapper = render()
		expect(headerBox(wrapper).attributes('data-indeterminate')).toBe('false')
		await rowBoxes(wrapper)[0].trigger('click')
		expect(headerBox(wrapper).attributes('data-indeterminate')).toBe('true')
	})

	it('clears the selection when the filter changes', async () => {
		const wrapper = render()
		await rowBoxes(wrapper)[0].trigger('click')
		routeHolder.query = { airport: 'LHR', airportDir: 'either' }
		await nextTick()
		expect(wrapper.find('.filter-count').text()).toBe('3 flights')
	})

	it('clears the selection from the "Clear selection" button', async () => {
		const wrapper = render()
		expect(wrapper.find('.clear-selection').exists()).toBe(false)
		await rowBoxes(wrapper)[0].trigger('click')
		await wrapper.find('.clear-selection').trigger('click')
		expect(wrapper.find('.filter-count').text()).toBe('3 flights')
	})

	it('clears the selection on Escape', async () => {
		const wrapper = render({ attachTo: document.body })
		await rowBoxes(wrapper)[0].trigger('click')
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
		await nextTick()
		expect(wrapper.find('.filter-count').text()).toBe('3 flights')
		wrapper.unmount()
	})

	it('does not open the editor when the checkbox cell is double-clicked', async () => {
		const wrapper = render()
		await wrapper.find('tbody td.select').trigger('dblclick')
		expect(push).not.toHaveBeenCalled()
	})

	it('hides the within-day reorder chevrons while selecting', async () => {
		store.flights = [1, 2].map((id) => ({ ...flight(id, 'AAA', 'BBB'), flightDate: '2026-03-15', daySeq: id }))
		const wrapper = render()
		expect(wrapper.findAll('td.reorder .nc-button')).toHaveLength(4)
		await rowBoxes(wrapper)[0].trigger('click')
		expect(wrapper.findAll('td.reorder .nc-button')).toHaveLength(0)
	})
})

describe('ViewFlightLog bulk edit', () => {
	const rowBoxes = (wrapper: ReturnType<typeof render>) => wrapper.findAll('tbody .select-box')

	it('offers bulk edit only while something is selected', async () => {
		const wrapper = render()
		expect(wrapper.find('.bulk-edit').exists()).toBe(false)
		await rowBoxes(wrapper)[0].trigger('click')
		await rowBoxes(wrapper)[1].trigger('click')
		expect(wrapper.find('.bulk-edit').text()).toBe('Edit 2 flights…')
	})

	it('opens the dialog with exactly the selected flights', async () => {
		const wrapper = render()
		// Rows read f3, f2, f1; select the first and last.
		await rowBoxes(wrapper)[0].trigger('click')
		await rowBoxes(wrapper)[2].trigger('click')
		await wrapper.find('.bulk-edit').trigger('click')
		expect(wrapper.find('.bulk-dialog').attributes('data-ids')).toBe('3,1')
	})

	it('clears the selection once the dialog reports a save', async () => {
		const wrapper = render()
		await rowBoxes(wrapper)[0].trigger('click')
		await wrapper.find('.bulk-edit').trigger('click')
		wrapper.findComponent({ name: 'BulkEditDialog' }).vm.$emit('saved')
		await nextTick()
		expect(wrapper.find('.filter-count').text()).toBe('3 flights')
	})

	it('keeps the selection when Escape closes the dialog', async () => {
		const wrapper = render({ attachTo: document.body })
		await rowBoxes(wrapper)[0].trigger('click')
		await wrapper.find('.bulk-edit').trigger('click')
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
		await nextTick()
		expect(wrapper.find('.filter-count').text()).toBe('3 flights · 1 selected')
		wrapper.unmount()
	})
})

// Card mode is decided by matchMedia (useCardLayout), which jsdom lacks; every
// other describe block therefore runs in the desktop table layout.
function mockCardLayout() {
	window.matchMedia = vi.fn().mockReturnValue({
		matches: true,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	}) as unknown as typeof window.matchMedia
}

describe('ViewFlightLog card layout', () => {
	// Default sort is date desc, so rows read f3, f2, f1 top to bottom.
	const rows = (wrapper: ReturnType<typeof render>) => wrapper.findAll('tbody tr')
	const rowBoxes = (wrapper: ReturnType<typeof render>) => wrapper.findAll('tbody .select-box')
	const dates = (wrapper: ReturnType<typeof render>) => rows(wrapper).map((r) => r.find('td.date').text())
	const sortItems = (wrapper: ReturnType<typeof render>) => wrapper.findAll('.sort-menu .row-action')
	const enterSelectMode = (wrapper: ReturnType<typeof render>) => wrapper.find('.enter-select-mode').trigger('click')

	beforeEach(mockCardLayout)
	afterEach(() => {
		// @ts-expect-error jsdom has no matchMedia; put that back.
		delete window.matchMedia
	})

	it('opens the shared Add flight dialog from the heading line', async () => {
		const wrapper = render()
		expect(addFlightOpen.value).toBe(false)

		await wrapper.find('.add-flight').trigger('click')
		expect(addFlightOpen.value).toBe(true)
	})

	it('opens the editor on a tap, carrying the active filter', async () => {
		routeHolder.query = { airport: 'LHR', airportDir: 'to' }
		const wrapper = render()
		await rows(wrapper)[0].find('td.route').trigger('click')
		expect(push).toHaveBeenCalledWith({
			path: '/flights/3/edit',
			query: { airport: 'LHR', airportDir: 'to' },
		})
	})

	it('shows no checkboxes until "Select" turns select mode on', async () => {
		const wrapper = render()
		expect(rowBoxes(wrapper)).toHaveLength(0)
		expect(wrapper.find('.select-cancel').exists()).toBe(false)

		await enterSelectMode(wrapper)
		expect(rowBoxes(wrapper)).toHaveLength(3)
		expect(wrapper.find('.enter-select-mode').exists()).toBe(false)
		expect(wrapper.find('.select-cancel').exists()).toBe(true)
		expect(wrapper.find('.clear-selection').exists()).toBe(false)
	})

	it('toggles the tapped card in select mode, even with nothing selected', async () => {
		const wrapper = render()
		await enterSelectMode(wrapper)
		await rows(wrapper)[1].find('td.route').trigger('click')
		expect(push).not.toHaveBeenCalled()
		expect(wrapper.find('.filter-count').text()).toBe('3 flights · 1 selected')
		expect(wrapper.find('.bulk-edit').exists()).toBe(true)

		// Emptying the selection stays in the mode: the next tap toggles again.
		await rows(wrapper)[1].find('td.route').trigger('click')
		expect(wrapper.find('.bulk-edit').exists()).toBe(false)
		await rows(wrapper)[0].find('td.route').trigger('click')
		expect(push).not.toHaveBeenCalled()
		expect(wrapper.find('.filter-count').text()).toBe('3 flights · 1 selected')
	})

	it('"Cancel" leaves select mode and clears the selection', async () => {
		const wrapper = render()
		await enterSelectMode(wrapper)
		await rowBoxes(wrapper)[0].trigger('click')
		await wrapper.find('.select-cancel').trigger('click')
		expect(rowBoxes(wrapper)).toHaveLength(0)
		expect(wrapper.find('.filter-count').text()).toBe('3 flights')
		expect(wrapper.find('.enter-select-mode').exists()).toBe(true)

		await rows(wrapper)[0].find('td.route').trigger('click')
		expect(push).toHaveBeenCalledWith({ path: '/flights/3/edit', query: {} })
	})

	it('leaves select mode on a filter change', async () => {
		const wrapper = render()
		await enterSelectMode(wrapper)
		await rowBoxes(wrapper)[0].trigger('click')
		routeHolder.query = { airport: 'LHR', airportDir: 'to' }
		await nextTick()
		expect(rowBoxes(wrapper)).toHaveLength(0)
		expect(wrapper.find('.select-cancel').exists()).toBe(false)
		expect(wrapper.find('.enter-select-mode').exists()).toBe(true)
	})

	it('leaves select mode on a successful bulk apply', async () => {
		const wrapper = render()
		await enterSelectMode(wrapper)
		await rowBoxes(wrapper)[0].trigger('click')
		await wrapper.findComponent({ name: 'BulkEditDialog' }).vm.$emit('saved')
		await nextTick()
		expect(rowBoxes(wrapper)).toHaveLength(0)
		expect(wrapper.find('.enter-select-mode').exists()).toBe(true)
	})

	it('leaves select mode on Esc, even with nothing selected', async () => {
		const wrapper = render({ attachTo: document.body })
		await enterSelectMode(wrapper)
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
		await nextTick()
		expect(rowBoxes(wrapper)).toHaveLength(0)
		expect(wrapper.find('.enter-select-mode').exists()).toBe(true)
		wrapper.unmount()
	})

	it('arrives in select mode when a selection is carried into the card layout', async () => {
		let onChange: (e: { matches: boolean }) => void = () => {}
		window.matchMedia = vi.fn().mockReturnValue({
			matches: false,
			addEventListener: (_: string, fn: typeof onChange) => { onChange = fn },
			removeEventListener: vi.fn(),
		}) as unknown as typeof window.matchMedia
		const wrapper = render()
		await rowBoxes(wrapper)[0].trigger('click')
		onChange({ matches: true })
		await nextTick()
		expect(rowBoxes(wrapper)).toHaveLength(3)
		expect(wrapper.find('.select-cancel').exists()).toBe(true)
		expect(wrapper.find('.filter-count').text()).toBe('3 flights · 1 selected')
	})

	it('leaves a tap on the checkbox to the checkbox', async () => {
		const wrapper = render()
		await enterSelectMode(wrapper)
		await rowBoxes(wrapper)[0].trigger('click')
		expect(push).not.toHaveBeenCalled()
		expect(wrapper.find('.filter-count').text()).toBe('3 flights · 1 selected')
	})

	it('leaves a tap on the row menu to the menu', async () => {
		const wrapper = render()
		await rows(wrapper)[0].find('td.actions').trigger('click')
		expect(push).not.toHaveBeenCalled()
	})

	it('does not act again on a double tap', async () => {
		const wrapper = render()
		await rows(wrapper)[0].trigger('dblclick')
		expect(push).not.toHaveBeenCalled()
	})

	it('does not treat a click as a tap in the table layout', async () => {
		// @ts-expect-error back to jsdom's missing matchMedia: the table layout.
		delete window.matchMedia
		const wrapper = render()
		await rows(wrapper)[0].find('td.route').trigger('click')
		expect(push).not.toHaveBeenCalled()
		expect(wrapper.find('.sort-menu').exists()).toBe(false)
	})

	it('sorts from the sort menu, and re-picking the active column reverses it', async () => {
		const wrapper = render()
		expect(dates(wrapper)).toEqual(['2026-01-03', '2026-01-02', '2026-01-01'])
		// Menu order follows the columns: Date, Flight, Route, Distance, …
		await sortItems(wrapper)[0].trigger('click')
		expect(dates(wrapper)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03'])
		await sortItems(wrapper)[0].trigger('click')
		expect(dates(wrapper)).toEqual(['2026-01-03', '2026-01-02', '2026-01-01'])
	})

	it('picks a new column in its default direction', async () => {
		const wrapper = render()
		// Distance defaults to longest first; f1 and f2 tie at 5555 and fall back to id.
		await sortItems(wrapper)[3].trigger('click')
		expect(dates(wrapper)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03'])
	})

	it('offers "Select all shown" only in select mode, selecting exactly the visible rows', async () => {
		routeHolder.query = { airport: 'LHR', airportDir: 'to' }
		const wrapper = render()
		expect(wrapper.find('.select-all-shown').exists()).toBe(false)
		await enterSelectMode(wrapper)
		await wrapper.find('.select-all-shown').trigger('click')
		expect(wrapper.find('.filter-count').text()).toBe('2 of 3 flights · 2 selected')
		expect(rows(wrapper).every((r) => r.classes('selected'))).toBe(true)
	})

	it('does not offer "Select all shown" in the table layout, which has the header box', async () => {
		// @ts-expect-error back to the table layout.
		delete window.matchMedia
		const wrapper = render()
		expect(wrapper.find('.enter-select-mode').exists()).toBe(false)
		await rowBoxes(wrapper)[0].trigger('click')
		expect(wrapper.find('.select-all-shown').exists()).toBe(false)
		expect(wrapper.find('.select-cancel').exists()).toBe(false)
		expect(wrapper.find('.clear-selection').exists()).toBe(true)
	})
})

describe('ViewFlightLog within-day reordering from the row menu', () => {
	function sameDay(id: number, daySeq: number) {
		return { ...flight(id, 'AAA', 'BBB'), flightDate: '2026-03-15', daySeq }
	}
	const rowMenu = (wrapper: ReturnType<typeof render>, rowIndex: number) => wrapper.findAll('tbody tr')[rowIndex]

	beforeEach(() => {
		store.flights = [sameDay(1, 1), sameDay(2, 2), sameDay(3, 3)]
	})

	it('offers each move only where the matching chevron is enabled', () => {
		const wrapper = render()
		expect(rowMenu(wrapper, 0).find('.move-up').exists()).toBe(false)
		expect(rowMenu(wrapper, 0).find('.move-down').exists()).toBe(true)
		expect(rowMenu(wrapper, 2).find('.move-up').exists()).toBe(true)
		expect(rowMenu(wrapper, 2).find('.move-down').exists()).toBe(false)
	})

	it('offers no moves on a single-leg day', () => {
		store.flights = [flight(1, 'AAA', 'BBB'), flight(2, 'CCC', 'DDD')]
		const wrapper = render()
		expect(wrapper.find('.move-up').exists()).toBe(false)
		expect(wrapper.find('.move-down').exists()).toBe(false)
	})

	it('"Move up" sends "later" under newest-first sort, like the up chevron', async () => {
		const wrapper = render()
		await rowMenu(wrapper, 1).find('.move-up').trigger('click')
		expect(store.move).toHaveBeenCalledWith(2, 'later')
	})

	it('"Move down" sends "earlier" under newest-first sort', async () => {
		const wrapper = render()
		await rowMenu(wrapper, 1).find('.move-down').trigger('click')
		expect(store.move).toHaveBeenCalledWith(2, 'earlier')
	})

	it('flips the mapping when the date sort is ascending', async () => {
		const wrapper = render()
		await wrapper.findAll('th .sort-button')[0].trigger('click')
		await rowMenu(wrapper, 1).find('.move-up').trigger('click')
		expect(store.move).toHaveBeenCalledWith(2, 'earlier')
	})

	it('hides the moves while a filter is active', () => {
		routeHolder.query = { airport: 'AAA', airportDir: 'from' }
		const wrapper = render()
		expect(wrapper.find('.move-up').exists()).toBe(false)
		expect(wrapper.find('.move-down').exists()).toBe(false)
	})
})

describe('ViewFlightLog load failure', () => {
	// Renders the name, description and action slot so the retry is clickable.
	const NcEmptyContent = {
		props: ['name', 'description'],
		template: '<div class="empty" :data-name="name">{{ description }}<slot name="action" /></div>',
	}
	const mountWithEmpty = () => mount(ViewFlightLog, { global: { stubs: { ...stubs, NcEmptyContent } } })
	const serverError = { response: { data: { ocs: { meta: { message: '' }, data: { message: 'Database unavailable' } } } } }

	beforeEach(() => {
		store.flights = []
		store.loaded = false
	})

	it('says the load failed, with a retry, instead of "No flights yet"', async () => {
		store.loadError = serverError
		const wrapper = mountWithEmpty()
		const empty = wrapper.find('.empty')
		expect(empty.attributes('data-name')).toBe('Could not load your flights')
		expect(empty.text()).toContain('Database unavailable')

		await empty.find('.nc-button').trigger('click')
		// Once on mount (not loaded), once for the retry.
		expect(store.fetchAll).toHaveBeenCalledTimes(2)
	})

	it('toasts the reason the server gave when loading fails', async () => {
		const { showError } = await import('@nextcloud/dialogs')
		store.fetchAll.mockRejectedValueOnce(serverError)
		mountWithEmpty()
		await flushPromises()
		expect(showError).toHaveBeenCalledWith('Database unavailable')
	})

	it('still reads "No flights yet" for a journal that loaded empty', () => {
		store.loaded = true
		const wrapper = mountWithEmpty()
		expect(wrapper.find('.empty').attributes('data-name')).toBe('No flights yet')
	})
})
