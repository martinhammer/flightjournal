import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

// Covers the apply-on-click commit logic for each filter type: the user picks
// a type, stages a value via the editor, clicks Apply, and the route is pushed
// with the expected query keys.

const { push, routeHolder } = vi.hoisted(() => ({
	push: vi.fn(),
	routeHolder: { query: {} as Record<string, string> },
}))

vi.mock('vue-router', async (importOriginal) => ({
	...await importOriginal<typeof import('vue-router')>(),
	useRoute: () => routeHolder,
	useRouter: () => ({ push }),
}))

// The picker probes airport reference data on mount to decide whether to offer
// the "Unmatched airports" filter. Mock it so each test controls the count.
const { listAirports } = vi.hoisted(() => ({ listAirports: vi.fn() }))
vi.mock('../../src/api.ts', () => ({ listAirports }))

import FilterPicker from '../../src/components/FilterPicker.vue'
import type { Flight } from '../../src/types.ts'

function flight(id: number, overrides: Partial<Flight> = {}): Flight {
	return {
		id,
		flightDate: '2026-01-01',
		originCode: 'LHR',
		destinationCode: 'JFK',
		originLabel: null,
		destinationLabel: null,
		airlineCode: null,
		flightNumber: null,
		aircraftTypeCode: null,
		aircraftTypeRaw: null,
		registration: null,
		cabinClass: null,
		seat: null,
		notes: null,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	}
}

// NcActions renders its default slot inline so we can reach every action item.
// We declare 'click' in emits so Vue treats the parent's @click as a component
// event listener (matches production), not a native listener that would catch
// bubbled clicks from inner buttons.
const NcActionsStub = defineComponent({
	emits: ['click'],
	render() {
		return h('div', this.$slots.default?.() ?? [])
	},
})

const NcActionButton = defineComponent({
	props: ['closeAfterClick'],
	emits: ['click'],
	render() {
		return h('button', { class: 'action-btn', onClick: () => this.$emit('click') }, this.$slots.default?.())
	},
})

const NcCheckboxRadioSwitch = defineComponent({
	props: ['modelValue'],
	emits: ['update:modelValue'],
	render() {
		return h('label', { class: 'cabin-checkbox' }, [
			h('input', {
				type: 'checkbox',
				checked: this.modelValue,
				onChange: (e: Event) => this.$emit('update:modelValue', (e.target as HTMLInputElement).checked),
			}),
			this.$slots.default?.(),
		])
	},
})

const NcButton = defineComponent({
	props: ['variant'],
	emits: ['click'],
	render() {
		const cls = this.variant === 'primary' ? 'apply-btn' : 'cancel-btn'
		return h('button', { class: cls, onClick: () => this.$emit('click') }, this.$slots.default?.())
	},
})

const NcDateTimePickerNative = defineComponent({
	props: ['modelValue'],
	emits: ['update:modelValue'],
	render() {
		return h('input', {
			class: 'date-input',
			type: 'date',
			onInput: (e: Event) => {
				const v = (e.target as HTMLInputElement).value
				this.$emit('update:modelValue', v ? new Date(`${v}T00:00:00`) : null)
			},
		})
	},
})

const NcTextField = defineComponent({
	props: ['modelValue'],
	emits: ['update:modelValue'],
	render() {
		return h('input', {
			class: 'text-input',
			value: this.modelValue,
			onInput: (e: Event) => this.$emit('update:modelValue', (e.target as HTMLInputElement).value),
		})
	},
})

const stubs = {
	NcActions: NcActionsStub,
	NcActionButton,
	NcActionSeparator: true,
	NcCheckboxRadioSwitch,
	NcButton,
	NcDateTimePickerNative,
	NcTextField,
	Plus: true,
}

function render(flights: Flight[] = []) {
	return mount(FilterPicker, {
		props: { flights },
		global: { stubs },
	})
}

beforeEach(() => {
	push.mockClear()
	routeHolder.query = {}
	// Default: no reference data, so the "Unmatched airports" item is hidden.
	listAirports.mockReset()
	listAirports.mockResolvedValue({ items: [], total: 0, limit: 1, offset: 0 })
})

// Text of every menu action button (after onMounted's reference-data probe).
async function menuItems(wrapper: ReturnType<typeof render>): Promise<string[]> {
	await flushPromises()
	return wrapper.findAll('.action-btn').map((b) => b.text())
}

// Picker order in the NcActions menu: Date range (0), Cabin class (1),
// Airline (2), Aircraft type (3).

describe('FilterPicker — cabin', () => {
	it('applies a cabin filter as a CSV query key', async () => {
		const wrapper = render()
		await wrapper.findAll('.action-btn')[1].trigger('click')
		await flushPromises()
		// Tick Business (index 2 in CABIN_CLASSES: economy, premium_economy, business).
		const checkboxes = wrapper.findAll('.cabin-checkbox input')
		await checkboxes[2].setValue(true)
		await wrapper.find('.apply-btn').trigger('click')
		expect(push).toHaveBeenCalledWith({ name: 'flights', query: { cabin: 'business' } })
	})

	it('drops the cabin key when applied empty', async () => {
		routeHolder.query = { cabin: 'business' }
		const wrapper = render()
		await wrapper.findAll('.action-btn')[1].trigger('click')
		await flushPromises()
		// Untick business (prefilled from the URL).
		const checkboxes = wrapper.findAll('.cabin-checkbox input')
		await checkboxes[2].setValue(false)
		await wrapper.find('.apply-btn').trigger('click')
		expect(push).toHaveBeenCalledWith({ name: 'flights', query: {} })
	})
})

describe('FilterPicker — dismissal', () => {
	it('closes the editor without committing when Cancel is clicked', async () => {
		const wrapper = render()
		await wrapper.findAll('.action-btn')[1].trigger('click')
		await flushPromises()
		expect(wrapper.find('.cancel-btn').exists()).toBe(true)
		await wrapper.find('.cancel-btn').trigger('click')
		expect(push).not.toHaveBeenCalled()
		expect(wrapper.find('.cancel-btn').exists()).toBe(false)
	})

	it('closes the editor when the user clicks outside the picker', async () => {
		const wrapper = render()
		await wrapper.findAll('.action-btn')[1].trigger('click')
		await flushPromises()
		expect(wrapper.find('.cancel-btn').exists()).toBe(true)
		// pointerdown outside the root
		document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
		await flushPromises()
		expect(wrapper.find('.cancel-btn').exists()).toBe(false)
		expect(push).not.toHaveBeenCalled()
	})
})

describe('FilterPicker — date range', () => {
	it('applies both endpoints', async () => {
		const wrapper = render()
		await wrapper.findAll('.action-btn')[0].trigger('click')
		await flushPromises()
		const dates = wrapper.findAll('.date-input')
		await dates[0].setValue('2025-01-01')
		await dates[1].setValue('2025-06-30')
		await wrapper.find('.apply-btn').trigger('click')
		expect(push).toHaveBeenCalledWith({
			name: 'flights',
			query: { dateFrom: '2025-01-01', dateTo: '2025-06-30' },
		})
	})
})

describe('FilterPicker — airline / aircraft', () => {
	it('applies an airline filter from ticked checkboxes (CSV in sorted order)', async () => {
		const flights = [
			flight(1, { airlineCode: 'EY' }),
			flight(2, { airlineCode: 'EK' }),
			flight(3, { airlineCode: 'FZ' }),
		]
		const wrapper = render(flights)
		await wrapper.findAll('.action-btn')[2].trigger('click')
		await flushPromises()
		// Options are sorted alphabetically: EK, EY, FZ. Tick EK and EY.
		const boxes = wrapper.findAll('.cabin-checkbox input')
		await boxes[0].setValue(true)
		await boxes[1].setValue(true)
		await wrapper.find('.apply-btn').trigger('click')
		expect(push).toHaveBeenCalledWith({
			name: 'flights',
			query: { airline: 'EK,EY' },
		})
	})

	it('narrows the airline list with the search field', async () => {
		const flights = [
			flight(1, { airlineCode: 'EY' }),
			flight(2, { airlineCode: 'EK' }),
			flight(3, { airlineCode: 'FZ' }),
		]
		const wrapper = render(flights)
		await wrapper.findAll('.action-btn')[2].trigger('click')
		await flushPromises()
		// Type "E" — should leave EK and EY, drop FZ.
		await wrapper.find('.text-input').setValue('E')
		const visible = wrapper.findAll('.cabin-checkbox')
		expect(visible).toHaveLength(2)
	})

	it('applies an aircraft-type filter from ticked checkboxes', async () => {
		const flights = [
			flight(1, { aircraftTypeCode: 'B77W' }),
			flight(2, { aircraftTypeCode: 'B789' }),
		]
		const wrapper = render(flights)
		await wrapper.findAll('.action-btn')[3].trigger('click')
		await flushPromises()
		// Sorted: B77W, B789. Tick B77W.
		const boxes = wrapper.findAll('.cabin-checkbox input')
		await boxes[0].setValue(true)
		await wrapper.find('.apply-btn').trigger('click')
		expect(push).toHaveBeenCalledWith({
			name: 'flights',
			query: { aircraft: 'B77W' },
		})
	})

	it('preserves other query keys when applying (filters compose)', async () => {
		routeHolder.query = { airport: 'LHR', airportDir: 'either' }
		const flights = [flight(1, { airlineCode: 'EY' })]
		const wrapper = render(flights)
		await wrapper.findAll('.action-btn')[2].trigger('click')
		await flushPromises()
		await wrapper.findAll('.cabin-checkbox input')[0].setValue(true)
		await wrapper.find('.apply-btn').trigger('click')
		expect(push).toHaveBeenCalledWith({
			name: 'flights',
			query: { airport: 'LHR', airportDir: 'either', airline: 'EY' },
		})
	})
})

describe('FilterPicker — unmatched airports', () => {
	it('hides the item when the instance has no reference data', async () => {
		const wrapper = render()
		expect(await menuItems(wrapper)).not.toContain('Unmatched airports')
	})

	it('shows the item when reference data exists', async () => {
		listAirports.mockResolvedValue({ items: [], total: 42, limit: 1, offset: 0 })
		const wrapper = render()
		expect(await menuItems(wrapper)).toContain('Unmatched airports')
	})

	it('hides the item when the filter is already active', async () => {
		listAirports.mockResolvedValue({ items: [], total: 42, limit: 1, offset: 0 })
		routeHolder.query = { unmatched: '1' }
		const wrapper = render()
		expect(await menuItems(wrapper)).not.toContain('Unmatched airports')
	})

	it('commits unmatched=1 on click, preserving other keys', async () => {
		listAirports.mockResolvedValue({ items: [], total: 42, limit: 1, offset: 0 })
		routeHolder.query = { airline: 'EY' }
		const wrapper = render()
		await flushPromises()
		const item = wrapper.findAll('.action-btn').find((b) => b.text() === 'Unmatched airports')!
		await item.trigger('click')
		expect(push).toHaveBeenCalledWith({ name: 'flights', query: { airline: 'EY', unmatched: '1' } })
	})
})

describe('FilterPicker — days with multiple flights', () => {
	it('hides the item when no date has more than one flight', async () => {
		const flights = [flight(1, { flightDate: '2026-01-01' }), flight(2, { flightDate: '2026-01-02' })]
		const wrapper = render(flights)
		expect(await menuItems(wrapper)).not.toContain('Days with multiple flights')
	})

	it('shows the item when a date carries more than one flight', async () => {
		const flights = [flight(1, { flightDate: '2026-01-01' }), flight(2, { flightDate: '2026-01-01' })]
		const wrapper = render(flights)
		expect(await menuItems(wrapper)).toContain('Days with multiple flights')
	})

	it('hides the item when the filter is already active', async () => {
		routeHolder.query = { multiday: '1' }
		const flights = [flight(1, { flightDate: '2026-01-01' }), flight(2, { flightDate: '2026-01-01' })]
		const wrapper = render(flights)
		expect(await menuItems(wrapper)).not.toContain('Days with multiple flights')
	})

	it('commits multiday=1 on click', async () => {
		const flights = [flight(1, { flightDate: '2026-01-01' }), flight(2, { flightDate: '2026-01-01' })]
		const wrapper = render(flights)
		await flushPromises()
		const item = wrapper.findAll('.action-btn').find((b) => b.text() === 'Days with multiple flights')!
		await item.trigger('click')
		expect(push).toHaveBeenCalledWith({ name: 'flights', query: { multiday: '1' } })
	})
})
