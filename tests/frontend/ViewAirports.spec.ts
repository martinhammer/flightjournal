import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// Catches the v8→v9 regression where the search box was bound with the v8
// `:value` / `@update:value` API instead of v9's `modelValue`: a wrong
// binding means the typed term never reaches the backend query.

const { listAirports } = vi.hoisted(() => ({ listAirports: vi.fn() }))

vi.mock('../../src/api.ts', () => ({ listAirports }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

import ViewAirports from '../../src/views/ViewAirports.vue'
import NcTextField from '@nextcloud/vue/components/NcTextField'

const stubs = {
	NcTextField: true,
	NcActions: true,
	NcActionButton: true,
	NcEmptyContent: true,
	NcLoadingIcon: true,
	NcButton: true,
	AirplaneLanding: true,
	AirplaneTakeoff: true,
	SwapHorizontal: true,
}

const emptyPage = { items: [], total: 0, limit: 100, offset: 0 }

beforeEach(() => {
	listAirports.mockReset()
	listAirports.mockResolvedValue(emptyPage)
})

afterEach(() => {
	vi.useRealTimers()
})

describe('ViewAirports search', () => {
	it('fetches the first page on mount', async () => {
		mount(ViewAirports, { global: { stubs } })
		await flushPromises()
		expect(listAirports).toHaveBeenLastCalledWith('', 100, 0)
	})

	it('queries the backend with the typed search term', async () => {
		vi.useFakeTimers()
		const wrapper = mount(ViewAirports, { global: { stubs } })
		await flushPromises()

		// Simulate the NcTextField emitting its v9 model event.
		wrapper.findComponent(NcTextField).vm.$emit('update:modelValue', 'LHR')
		await flushPromises()
		vi.advanceTimersByTime(250)
		await flushPromises()

		expect(listAirports).toHaveBeenLastCalledWith('LHR', 100, 0)
	})
})
