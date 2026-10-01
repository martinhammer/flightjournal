import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// The airport counterpart of AircraftResolution.spec. Beyond the shared
// behaviours (asks the server, debounces, tells a miss from an empty table) it
// pins the reported kind, which the bulk editor turns into a code-loss warning.

const { resolveAirport } = vi.hoisted(() => ({ resolveAirport: vi.fn() }))
vi.mock('../../src/api.ts', () => ({ resolveAirport }))

import AirportResolution from '../../src/components/AirportResolution.vue'

const matched = { match: { code: 'LHR', name: 'London Heathrow' }, referenceLoaded: true }
const noMatch = { match: null, referenceLoaded: true }
const noReference = { match: null, referenceLoaded: false }

async function settle(wrapper: ReturnType<typeof mount>) {
	await vi.advanceTimersByTimeAsync(300)
	await flushPromises()
	return wrapper
}

const lastKind = (wrapper: ReturnType<typeof mount>) => wrapper.emitted('update:kind')?.at(-1)?.[0]

describe('AirportResolution', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.clearAllMocks()
		resolveAirport.mockResolvedValue(matched)
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('reports the code and the reference name the label will become', async () => {
		const wrapper = await settle(mount(AirportResolution, { props: { label: 'heathrow' } }))

		expect(resolveAirport).toHaveBeenCalledWith('heathrow')
		expect(wrapper.text()).toBe('Matches LHR · London Heathrow')
		expect(lastKind(wrapper)).toBe('matched')
	})

	it('reports a genuine miss', async () => {
		resolveAirport.mockResolvedValue(noMatch)
		const wrapper = await settle(mount(AirportResolution, { props: { label: 'Dublin' } }))

		expect(wrapper.text()).toBe('No airport reference data match.')
		expect(lastKind(wrapper)).toBe('unmatched')
	})

	it('distinguishes an empty reference table from a genuine miss', async () => {
		resolveAirport.mockResolvedValue(noReference)
		const wrapper = await settle(mount(AirportResolution, { props: { label: 'LHR' } }))

		expect(wrapper.text()).toContain('on this instance')
		expect(lastKind(wrapper)).toBe('noReference')
	})

	it('says nothing and asks nothing while the field is empty', async () => {
		const wrapper = await settle(mount(AirportResolution, { props: { label: null } }))

		expect(resolveAirport).not.toHaveBeenCalled()
		expect(wrapper.text().trim()).toBe('')
	})

	it('debounces rather than querying on every keystroke', async () => {
		const wrapper = mount(AirportResolution, { props: { label: 'L' } })
		await wrapper.setProps({ label: 'LH' })
		await wrapper.setProps({ label: 'LHR' })
		await settle(wrapper)

		expect(resolveAirport).toHaveBeenCalledTimes(1)
		expect(resolveAirport).toHaveBeenCalledWith('LHR')
	})

	it('drops an in-flight result when the field is cleared', async () => {
		let release: (v: unknown) => void = () => {}
		resolveAirport.mockReturnValue(new Promise((r) => { release = r }))
		const wrapper = mount(AirportResolution, { props: { label: 'LHR' } })
		await vi.advanceTimersByTimeAsync(300)

		await wrapper.setProps({ label: null })
		release(matched)
		await flushPromises()

		expect(wrapper.text().trim()).toBe('')
		expect(lastKind(wrapper)).toBe('idle')
	})

	it('reports a failed lookup rather than implying no match', async () => {
		resolveAirport.mockRejectedValue(new Error('offline'))
		const wrapper = await settle(mount(AirportResolution, { props: { label: 'LHR' } }))

		expect(wrapper.text()).toContain('Could not check')
		expect(lastKind(wrapper)).toBe('error')
	})
})
