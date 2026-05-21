import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// Catches the v8→v9 NcButton regression: the Save control relies on being a
// native submit button (the form submits via `@submit.prevent`, the button has
// no `@click`). v8's `native-type="submit"` is ignored by v9, which silently
// turned Save into a plain non-submitting button.

const { store, push } = vi.hoisted(() => ({
	store: {
		loaded: true,
		flights: [] as unknown[],
		fetchAll: vi.fn(),
		update: vi.fn().mockResolvedValue({}),
	},
	push: vi.fn(),
}))

vi.mock('../../src/store/flights.ts', () => ({ useFlightsStore: () => store }))
// Keep vue-router's real exports (NcButton injects `routerKey`); override only
// the composables the view uses.
vi.mock('vue-router', async (importOriginal) => ({
	...await importOriginal<typeof import('vue-router')>(),
	useRoute: () => ({ params: { id: '1' }, query: {} }),
	useRouter: () => ({ push }),
}))

import EditFlightLog from '../../src/views/EditFlightLog.vue'

const flight = {
	id: 1,
	flightDate: '2026-05-01',
	originCode: 'CPH',
	destinationCode: 'LHR',
	originLabel: 'Copenhagen Kastrup',
	destinationLabel: 'London Heathrow',
	airlineCode: 'SK',
	flightNumber: '4745',
	aircraftTypeCode: null,
	aircraftTypeRaw: 'A320',
	registration: 'OY-KAL',
	cabinClass: 'economy',
	seat: '14C',
	notes: null,
	createdAt: 0,
	updatedAt: 0,
}

// Keep NcButton real — the regression is in how the button is configured.
const stubs = {
	NcTextField: true,
	NcSelect: true,
	NcDateTimePickerNative: true,
}

async function mountLoaded() {
	store.flights = [flight]
	const wrapper = mount(EditFlightLog, { global: { stubs } })
	await flushPromises()
	return wrapper
}

beforeEach(() => {
	store.update.mockClear()
	push.mockClear()
})

describe('EditFlightLog save', () => {
	it('renders the Save control as a native submit button', async () => {
		const wrapper = await mountLoaded()
		const submit = wrapper.find('button[type="submit"]')
		expect(submit.exists()).toBe(true)
		expect(submit.text()).toBe('Save')
	})

	it('submitting the form persists via the store', async () => {
		const wrapper = await mountLoaded()
		await wrapper.find('form').trigger('submit')
		await flushPromises()
		expect(store.update).toHaveBeenCalledTimes(1)
		expect(store.update).toHaveBeenCalledWith(1, expect.objectContaining({
			originLabel: 'Copenhagen Kastrup',
			destinationLabel: 'London Heathrow',
		}))
	})
})
