import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { showError } from '@nextcloud/dialogs'

// Covers the save-failure path: the server's validation message must reach the
// toast. (It used to read meta.message, which the server leaves empty for our
// DataResponse errors, so the toast came up blank.)

const { store } = vi.hoisted(() => ({ store: { create: vi.fn() } }))
vi.mock('../../src/store/flights.ts', () => ({ useFlightsStore: () => store }))

import AddFlightDialog from '../../src/views/AddFlightDialog.vue'

/** A 400 exactly as the server renders our DataResponse(['message' => …]): meta.message is ''. */
const serverError = (message: string) => ({
	response: { data: { ocs: { meta: { status: 'failure', statuscode: 400, message: '' }, data: { message } } } },
})

const NcTextField = {
	props: ['modelValue', 'label'],
	emits: ['update:modelValue'],
	template: '<input class="text-field" :data-label="label" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)">',
}

const stubs = {
	NcDialog: { props: ['open'], template: '<div v-if="open"><slot /><slot name="actions" /></div>' },
	NcButton: { emits: ['click'], template: '<button class="nc-button" @click="$emit(\'click\')"><slot /></button>' },
	NcTextField,
	NcSelect: true,
	NcDateTimePickerNative: true,
	AircraftTypeField: true,
}

async function mountFilled() {
	const wrapper = mount(AddFlightDialog, { props: { open: false }, global: { stubs } })
	await wrapper.setProps({ open: true })
	await wrapper.find('[data-label="Origin"]').setValue('CPH')
	await wrapper.find('[data-label="Destination"]').setValue('LHR')
	return wrapper
}

beforeEach(() => {
	store.create.mockReset()
	vi.mocked(showError).mockClear()
})

describe('AddFlightDialog save failure', () => {
	it('shows the server\'s validation message and stays open', async () => {
		store.create.mockRejectedValueOnce(serverError('Invalid cabinClass'))
		const wrapper = await mountFilled()
		await wrapper.find('.nc-button').trigger('click')
		await flushPromises()

		expect(showError).toHaveBeenCalledWith('Invalid cabinClass')
		expect(wrapper.emitted('update:open')).toBeUndefined()
	})

	it('falls back to a generic message when the request fails without one', async () => {
		store.create.mockRejectedValueOnce(new Error('Network Error'))
		const wrapper = await mountFilled()
		await wrapper.find('.nc-button').trigger('click')
		await flushPromises()

		expect(showError).toHaveBeenCalledWith('Failed to save flight')
	})
})

describe('AddFlightDialog default date', () => {
	const originalTz = process.env.TZ

	afterEach(() => {
		vi.useRealTimers()
		if (originalTz === undefined) delete process.env.TZ
		else process.env.TZ = originalTz
	})

	async function savedDateAt(tz: string, offsetMinutes: number, instant: string) {
		process.env.TZ = tz
		vi.useFakeTimers({ toFake: ['Date'] })
		vi.setSystemTime(new Date(instant))
		// Guards against a runner where assigning TZ has no effect: the test would
		// then pass on the UTC date, proving nothing.
		expect(new Date().getTimezoneOffset()).toBe(offsetMinutes)

		store.create.mockResolvedValueOnce({})
		const wrapper = await mountFilled()
		await wrapper.find('.nc-button').trigger('click')
		await flushPromises()
		return store.create.mock.calls[0][0].flightDate
	}

	it('is the local date just after midnight east of UTC, where UTC is still yesterday', async () => {
		// 00:30 on 10 March in Tokyo.
		expect(await savedDateAt('Asia/Tokyo', -540, '2026-03-09T15:30:00Z')).toBe('2026-03-10')
	})

	it('is the local date in the evening west of UTC, where UTC is already tomorrow', async () => {
		// 20:30 on 9 March in New York.
		expect(await savedDateAt('America/New_York', 240, '2026-03-10T00:30:00Z')).toBe('2026-03-09')
	})
})
