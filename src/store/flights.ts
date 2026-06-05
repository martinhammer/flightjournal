import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as api from '../api.ts'
import type { Flight, FlightInput } from '../types.ts'

export const useFlightsStore = defineStore('flights', () => {
	const flights = ref<Flight[]>([])
	const loading = ref(false)
	const loaded = ref(false)

	async function fetchAll() {
		loading.value = true
		try {
			flights.value = await api.listFlights()
			loaded.value = true
		} finally {
			loading.value = false
		}
	}

	async function create(input: FlightInput) {
		const created = await api.createFlight(input)
		flights.value = [created, ...flights.value]
		return created
	}

	async function update(id: number, input: FlightInput) {
		const updated = await api.updateFlight(id, input)
		flights.value = flights.value.map((f) => (f.id === id ? updated : f))
		return updated
	}

	async function remove(id: number) {
		await api.deleteFlight(id)
		flights.value = flights.value.filter((f) => f.id !== id)
	}

	// A move swaps day_seq between two flights server-side; the endpoint returns
	// only the moved one, so re-fetch to pick up the neighbour's new order too.
	async function move(id: number, direction: api.MoveDirection) {
		await api.moveFlight(id, direction)
		flights.value = await api.listFlights()
	}

	return { flights, loading, loaded, fetchAll, create, update, remove, move }
})
