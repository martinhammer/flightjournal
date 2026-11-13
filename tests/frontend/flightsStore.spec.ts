import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// Covers the store's list sequencing: responses that settle out of order, or
// that were requested before a local write, must not overwrite newer state.

const api = vi.hoisted(() => ({
	listFlights: vi.fn(),
	createFlight: vi.fn(),
	updateFlight: vi.fn(),
	bulkUpdateFlights: vi.fn(),
	deleteFlight: vi.fn(),
	moveFlight: vi.fn(),
}))
vi.mock('../../src/api.ts', () => api)

import { useFlightsStore } from '../../src/store/flights.ts'

/** A promise the test settles by hand, to choose the order responses arrive in. */
function deferred<T>() {
	let settle!: (value: T) => void
	let fail!: (reason: unknown) => void
	const promise = new Promise<T>((resolve, reject) => {
		settle = resolve
		fail = reject
	})
	return { promise, resolve: settle, reject: fail }
}

const leg = (id: number, daySeq = 1) => ({ id, flightDate: '2026-05-01', daySeq })

beforeEach(() => {
	setActivePinia(createPinia())
	Object.values(api).forEach((fn) => fn.mockReset())
})

describe('flights store', () => {
	it('keeps the newest of two move refetches when the older one settles last', async () => {
		const store = useFlightsStore()
		api.moveFlight.mockResolvedValue(leg(1))
		const first = deferred<unknown[]>()
		const second = deferred<unknown[]>()
		api.listFlights.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

		const m1 = store.move(1, 'later')
		await vi.waitFor(() => expect(api.listFlights).toHaveBeenCalledTimes(1))
		const m2 = store.move(1, 'later')
		await vi.waitFor(() => expect(api.listFlights).toHaveBeenCalledTimes(2))

		second.resolve([leg(2, 1), leg(1, 3)])
		first.resolve([leg(1, 2), leg(2, 1)])
		await Promise.all([m1, m2])

		expect(store.flights).toEqual([leg(2, 1), leg(1, 3)])
	})

	it('reports a move as pending until its refetch has landed', async () => {
		const store = useFlightsStore()
		api.moveFlight.mockResolvedValue(leg(1))
		const list = deferred<unknown[]>()
		api.listFlights.mockReturnValueOnce(list.promise)

		const m = store.move(1, 'later')
		expect(store.moving).toBe(true)
		await vi.waitFor(() => expect(api.listFlights).toHaveBeenCalled())
		expect(store.moving).toBe(true)

		list.resolve([leg(1)])
		await m
		expect(store.moving).toBe(false)
	})

	it('ends the pending move when it fails', async () => {
		const store = useFlightsStore()
		api.moveFlight.mockRejectedValue(new Error('500'))
		await expect(store.move(1, 'later')).rejects.toThrow('500')
		expect(store.moving).toBe(false)
	})

	it('does not drop a flight created while an older list request was in flight', async () => {
		const store = useFlightsStore()
		const stale = deferred<unknown[]>()
		api.listFlights.mockReturnValueOnce(stale.promise).mockResolvedValueOnce([leg(9), leg(1)])
		api.createFlight.mockResolvedValue(leg(9))

		const load = store.fetchAll()
		await store.create({} as never)
		stale.resolve([leg(1)])
		await load

		// The stale list was set aside and asked for again.
		expect(api.listFlights).toHaveBeenCalledTimes(2)
		expect(store.flights.map((f) => f.id)).toEqual([9, 1])
		expect(store.loaded).toBe(true)
	})

	it('keeps the error of a failed load, still rejecting, and clears it on success', async () => {
		const store = useFlightsStore()
		const err = new Error('Network Error')
		api.listFlights.mockRejectedValueOnce(err).mockResolvedValueOnce([leg(1)])

		await expect(store.fetchAll()).rejects.toBe(err)
		expect(store.loadError).toBe(err)
		expect(store.loaded).toBe(false)
		expect(store.loading).toBe(false)

		await store.fetchAll()
		expect(store.loadError).toBeNull()
		expect(store.loaded).toBe(true)
	})
})
