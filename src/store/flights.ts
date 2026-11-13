import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as api from '../api.ts'
import type { BulkChanges, Flight, FlightInput } from '../types.ts'

export const useFlightsStore = defineStore('flights', () => {
	const flights = ref<Flight[]>([])
	const loading = ref(false)
	const loaded = ref(false)
	/** Set when the last full load failed; cleared by the next one that succeeds. */
	const loadError = ref<unknown>(null)
	const pendingMoves = ref(0)
	/** True while a move is being applied, so its row's neighbours are not yet known. */
	const moving = computed(() => pendingMoves.value > 0)

	// List responses can settle out of order (two quick moves each refetch), and
	// a list requested before a local write cannot contain it. So only the newest
	// request may assign, and only if no write landed while it was in flight —
	// otherwise it asks again.
	let latestList = 0
	let writes = 0

	async function refresh(): Promise<void> {
		const mine = ++latestList
		const writesAtStart = writes
		const list = await api.listFlights()
		if (mine !== latestList) return
		if (writes !== writesAtStart) return refresh()
		flights.value = list
		loaded.value = true
	}

	async function fetchAll() {
		loading.value = true
		try {
			await refresh()
			loadError.value = null
		} catch (e) {
			loadError.value = e
			throw e
		} finally {
			loading.value = false
		}
	}

	async function create(input: FlightInput) {
		const created = await api.createFlight(input)
		writes++
		flights.value = [created, ...flights.value]
		return created
	}

	async function update(id: number, input: FlightInput) {
		const updated = await api.updateFlight(id, input)
		writes++
		flights.value = flights.value.map((f) => (f.id === id ? updated : f))
		return updated
	}

	async function bulkUpdate(ids: number[], changes: BulkChanges) {
		const updated = new Map((await api.bulkUpdateFlights(ids, changes)).map((f) => [f.id, f]))
		writes++
		flights.value = flights.value.map((f) => updated.get(f.id) ?? f)
		return [...updated.values()]
	}

	async function remove(id: number) {
		await api.deleteFlight(id)
		writes++
		flights.value = flights.value.filter((f) => f.id !== id)
	}

	// A move swaps day_seq between two flights server-side; the endpoint returns
	// only the moved one, so re-fetch to pick up the neighbour's new order too.
	async function move(id: number, direction: api.MoveDirection) {
		pendingMoves.value++
		try {
			await api.moveFlight(id, direction)
			writes++
			await refresh()
		} finally {
			pendingMoves.value--
		}
	}

	return { flights, loading, loaded, loadError, moving, fetchAll, create, update, bulkUpdate, remove, move }
})
