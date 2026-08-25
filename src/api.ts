import axios from '@nextcloud/axios'
import { generateOcsUrl } from '@nextcloud/router'
import type { AircraftType, Airport, Flight, FlightInput } from './types.ts'

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

export type MoveDirection = 'earlier' | 'later'

export async function moveFlight(id: number, direction: MoveDirection): Promise<Flight> {
	const res = await axios.post<OcsResponse<Flight>>(url(`/api/v1/flights/${id}/move`), { direction }, config)
	return res.data.ocs.data
}

export interface AirportPage {
	items: Airport[]
	total: number
	limit: number
	offset: number
}

export async function listAirports(q: string, limit: number, offset: number, flownOnly = true): Promise<AirportPage> {
	const params = new URLSearchParams()
	if (q.trim()) params.set('q', q.trim())
	params.set('limit', String(limit))
	params.set('offset', String(offset))
	params.set('flownOnly', flownOnly ? 'true' : 'false')
	const res = await axios.get<OcsResponse<AirportPage>>(url(`/api/v1/airports?${params.toString()}`), config)
	return res.data.ocs.data
}

export interface AircraftTypePage {
	items: AircraftType[]
	total: number
	limit: number
	offset: number
}

export async function listAircraftTypes(q: string, limit: number, offset: number, flownOnly = true): Promise<AircraftTypePage> {
	const params = new URLSearchParams()
	if (q.trim()) params.set('q', q.trim())
	params.set('limit', String(limit))
	params.set('offset', String(offset))
	params.set('flownOnly', flownOnly ? 'true' : 'false')
	const res = await axios.get<OcsResponse<AircraftTypePage>>(url(`/api/v1/aircraft-types?${params.toString()}`), config)
	return res.data.ocs.data
}

export interface AircraftResolution {
	match: { code: string; manufacturer: string | null; model: string | null } | null
	/** False when the instance has no aircraft reference data at all. */
	referenceLoaded: boolean
}

/**
 * Ask the server what a free-text aircraft entry resolves to, without saving.
 * Uses the same resolver reconciliation does, so the editor previews the real
 * answer rather than a client-side approximation of it.
 *
 * @param q The free text as typed.
 */
export async function resolveAircraftType(q: string): Promise<AircraftResolution> {
	const params = new URLSearchParams({ q })
	const res = await axios.get<OcsResponse<AircraftResolution>>(
		url(`/api/v1/aircraft-types/resolve?${params.toString()}`), config,
	)
	return res.data.ocs.data
}

export async function getAirportsByCodes(codes: string[]): Promise<Airport[]> {
	if (codes.length === 0) return []
	const params = new URLSearchParams({ codes: codes.join(',') })
	const res = await axios.get<OcsResponse<{ items: Airport[] }>>(
		url(`/api/v1/airports/by-codes?${params.toString()}`), config,
	)
	return res.data.ocs.data.items
}
