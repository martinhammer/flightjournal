import axios from '@nextcloud/axios'
import { generateOcsUrl } from '@nextcloud/router'
import { Airport, Flight, FlightInput } from './types.ts'

const url = (path: string) => {
	const base = generateOcsUrl('apps/flightjournal' + path)
	return base.includes('?') ? `${base}&format=json` : `${base}?format=json`
}

const config = {
	headers: {
		'OCS-APIRequest': 'true',
		Accept: 'application/json',
	},
}

interface OcsResponse<T> {
	ocs: { meta: { status: string; statuscode: number; message: string }; data: T }
}

export async function listFlights(): Promise<Flight[]> {
	const res = await axios.get<OcsResponse<Flight[]>>(url('/api/v1/flights'), config)
	return res.data.ocs.data
}

export async function createFlight(input: FlightInput): Promise<Flight> {
	const res = await axios.post<OcsResponse<Flight>>(url('/api/v1/flights'), input, config)
	return res.data.ocs.data
}

export async function updateFlight(id: number, input: FlightInput): Promise<Flight> {
	const res = await axios.put<OcsResponse<Flight>>(url(`/api/v1/flights/${id}`), input, config)
	return res.data.ocs.data
}

export async function deleteFlight(id: number): Promise<void> {
	await axios.delete(url(`/api/v1/flights/${id}`), config)
}

export interface AirportPage {
	items: Airport[]
	total: number
	limit: number
	offset: number
}

export async function listAirports(q: string, limit: number, offset: number): Promise<AirportPage> {
	const params = new URLSearchParams()
	if (q.trim()) params.set('q', q.trim())
	params.set('limit', String(limit))
	params.set('offset', String(offset))
	const res = await axios.get<OcsResponse<AirportPage>>(url(`/api/v1/airports?${params.toString()}`), config)
	return res.data.ocs.data
}
