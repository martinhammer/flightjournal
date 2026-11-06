import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

// Covers the shared open state: anything setting addFlightOpen opens the one
// dialog App renders, and the navigation entry stays wired to it.

vi.mock('../../src/store/mapSettings.ts', () => ({
	PROJECTIONS: [],
	useMapSettingsStore: () => ({ projection: 'mercator' }),
}))

import App from '../../src/App.vue'
import { addFlightOpen } from '../../src/addFlight.ts'

const AddFlightDialog = {
	name: 'AddFlightDialog',
	props: ['open'],
	emits: ['update:open'],
	template: '<div class="add-dialog" :data-open="open" @click="$emit(\'update:open\', false)" />',
}

const slotStub = { template: '<div><slot /><slot name="list" /><slot name="footer" /></div>' }

const stubs = {
	AddFlightDialog,
	NcContent: slotStub,
	NcAppNavigation: slotStub,
	NcAppContent: slotStub,
	NcAppNavigationSettings: slotStub,
	NcAppNavigationItem: true,
	NcCheckboxRadioSwitch: true,
	RouterView: true,
}

const render = () => mount(App, { global: { stubs } })

beforeEach(() => {
	addFlightOpen.value = false
})

describe('App Add flight dialog', () => {
	it('renders the dialog once, closed', () => {
		const dialogs = render().findAll('.add-dialog')
		expect(dialogs).toHaveLength(1)
		expect(dialogs[0].attributes('data-open')).toBe('false')
	})

	it('opens when the shared state is set from elsewhere', async () => {
		const wrapper = render()
		addFlightOpen.value = true
		await nextTick()
		expect(wrapper.find('.add-dialog').attributes('data-open')).toBe('true')
	})

	it('opens from the navigation entry', async () => {
		const wrapper = render()
		await wrapper.find('.app-navigation-new button').trigger('click')
		expect(addFlightOpen.value).toBe(true)
		expect(wrapper.find('.add-dialog').attributes('data-open')).toBe('true')
	})

	it('writes the dialog closing back to the shared state', async () => {
		addFlightOpen.value = true
		const wrapper = render()
		await wrapper.find('.add-dialog').trigger('click')
		expect(addFlightOpen.value).toBe(false)
	})
})
