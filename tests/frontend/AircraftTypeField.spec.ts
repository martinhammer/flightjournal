import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// Covers the aircraft type-ahead. The behaviours that matter are the ones that
// decide what actually gets stored: a pick sets the reference triple, a pick
// never overwrites the user's typed text, and editing the text invalidates a
// pick made against the previous text.

const { listAircraftTypes } = vi.hoisted(() => ({ listAircraftTypes: vi.fn() }))
vi.mock('../../src/api.ts', () => ({
	listAircraftTypes,
	resolveAircraftType: vi.fn().mockResolvedValue({ match: null, referenceLoaded: true }),
}))

import AircraftTypeField from '../../src/components/AircraftTypeField.vue'
import NcTextField from '@nextcloud/vue/components/NcTextField'

const b738 = {
	id: 1, icaoCode: 'B738', iataCode: null, manufacturer: 'BOEING', model: '737-800',
	modelNormalized: '737800', engineType: 'Jet', engineCount: 2, wtc: 'M',
	description: 'LandPlane', canonical: true, source: 'csv-upload', updatedAt: 0,
}
const b738bbj = { ...b738, id: 2, model: '737-800 BBJ2', canonical: false }

const stubs = {
	NcTextField: true,
	NcButton: { template: '<button class="nc-btn" @click="$emit(\'click\')"><slot /></button>' },
	Close: true,
	AircraftResolution: true,
}

function render(raw: string | null = null) {
	return mount(AircraftTypeField, {
		props: {
			raw,
			selection: null,
			'onUpdate:raw': (v: string | null) => wrapperProps.raw = v,
			'onUpdate:selection': (v: unknown) => wrapperProps.selection = v,
		},
		global: { stubs },
	})
}

// Captures what the component emits upward, standing in for the parent form.
const wrapperProps: { raw: string | null; selection: unknown } = { raw: null, selection: null }

async function type(wrapper: ReturnType<typeof render>, text: string) {
	await wrapper.findComponent(NcTextField).vm.$emit('update:model-value', text)
	await vi.advanceTimersByTimeAsync(250)
	await flushPromises()
}

describe('AircraftTypeField', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.clearAllMocks()
		wrapperProps.raw = null
		wrapperProps.selection = null
		listAircraftTypes.mockResolvedValue({ items: [b738, b738bbj], total: 2, limit: 8, offset: 0 })
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('suggests matches for what has been typed', async () => {
		const wrapper = render()
		await type(wrapper, 'B738')

		expect(listAircraftTypes).toHaveBeenCalledWith('B738', 8, 0, false)
		const items = wrapper.findAll('.suggestion')
		expect(items).toHaveLength(2)
		expect(items[0].text()).toContain('BOEING 737-800')
	})

	it('emits the reference triple when a suggestion is picked', async () => {
		const wrapper = render()
		await type(wrapper, 'B738')
		await wrapper.findAll('.suggestion')[1].trigger('click')

		expect(wrapperProps.selection).toEqual({
			code: 'B738', manufacturer: 'BOEING', model: '737-800 BBJ2',
		})
	})

	/**
	 * The reference values have their own columns, so a pick must leave the typed
	 * text alone — it is the only record of what the user actually entered, and
	 * what a future bulk "fix everything that says X" would group on.
	 */
	it('does not overwrite the typed text when picking', async () => {
		const wrapper = render()
		await type(wrapper, 'the big boeing')
		await wrapper.findAll('.suggestion')[0].trigger('click')

		expect(wrapperProps.raw).toBe('the big boeing')
	})

	it('clears a pick once the text is edited', async () => {
		const wrapper = render()
		await type(wrapper, 'B738')
		await wrapper.findAll('.suggestion')[0].trigger('click')
		expect(wrapperProps.selection).not.toBeNull()

		await wrapper.setProps({ selection: wrapperProps.selection as never })
		await type(wrapper, 'B77W')

		expect(wrapperProps.selection).toBeNull()
	})

	it('debounces rather than querying on every keystroke', async () => {
		const wrapper = render()
		const field = wrapper.findComponent(NcTextField)
		await field.vm.$emit('update:model-value', 'B')
		await field.vm.$emit('update:model-value', 'B7')
		await field.vm.$emit('update:model-value', 'B738')
		await vi.advanceTimersByTimeAsync(250)
		await flushPromises()

		expect(listAircraftTypes).toHaveBeenCalledTimes(1)
	})

	it('shows no list and asks for nothing when the field is emptied', async () => {
		const wrapper = render()
		await type(wrapper, 'B738')
		expect(wrapper.findAll('.suggestion')).toHaveLength(2)

		listAircraftTypes.mockClear()
		await type(wrapper, '')

		expect(listAircraftTypes).not.toHaveBeenCalled()
		expect(wrapper.findAll('.suggestion')).toHaveLength(0)
	})

	/**
	 * The free-text path must survive an instance with no reference data, so a
	 * failed or empty lookup is silent rather than an error state.
	 */
	it('stays usable as a plain text field when the lookup fails', async () => {
		listAircraftTypes.mockRejectedValue(new Error('offline'))
		const wrapper = render()
		await type(wrapper, 'B738')

		expect(wrapperProps.raw).toBe('B738')
		expect(wrapper.findAll('.suggestion')).toHaveLength(0)
	})

	it('lets a pick be cleared, restoring the free-text preview', async () => {
		const wrapper = render()
		await wrapper.setProps({ selection: { code: 'B738', manufacturer: 'BOEING', model: '737-800' } })

		expect(wrapper.text()).toContain('Using B738 · BOEING 737-800')
		await wrapper.find('button.nc-btn').trigger('click')

		expect(wrapperProps.selection).toBeNull()
	})

	it('keyboard-selects a suggestion with arrow keys and enter', async () => {
		const wrapper = render()
		await type(wrapper, 'B738')

		const field = wrapper.findComponent(NcTextField)
		await field.vm.$emit('keydown', new KeyboardEvent('keydown', { key: 'ArrowDown' }))
		await field.vm.$emit('keydown', new KeyboardEvent('keydown', { key: 'ArrowDown' }))
		await field.vm.$emit('keydown', new KeyboardEvent('keydown', { key: 'Enter' }))

		expect(wrapperProps.selection).toEqual({
			code: 'B738', manufacturer: 'BOEING', model: '737-800 BBJ2',
		})
	})
})
