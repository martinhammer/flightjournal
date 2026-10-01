import { describe, it, expect, vi, beforeEach } from 'vitest'
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
