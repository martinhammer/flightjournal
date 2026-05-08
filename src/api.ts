import axios from '@nextcloud/axios'
import { generateOcsUrl } from '@nextcloud/router'
import { Flight, FlightInput } from './types.ts'

const url = (path: string) => generateOcsUrl('apps/flightjournal' + path)

interface OcsResponse<T> {
	ocs: { meta: { status: string; statuscode: number; message: string }; data: T }
}

export async function listFlights(): Promise<Flight[]> {
	const res = await axios.get<OcsResponse<Flight[]>>(url('/api/v1/flights'))
	return res.data.ocs.data
}

export async function createFlight(input: FlightInput): Promise<Flight> {
	const res = await axios.post<OcsResponse<Flight>>(url('/api/v1/flights'), input)
	return res.data.ocs.data
}

export async function updateFlight(id: number, input: FlightInput): Promise<Flight> {
	const res = await axios.put<OcsResponse<Flight>>(url(`/api/v1/flights/${id}`), input)
	return res.data.ocs.data
}

export async function deleteFlight(id: number): Promise<void> {
	await axios.delete(url(`/api/v1/flights/${id}`))
}
