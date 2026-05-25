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
})

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
