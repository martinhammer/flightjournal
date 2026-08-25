import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// Covers the editor's aircraft feedback line. The point of this component is to
// preview what reconciliation *will* do on save, so the behaviours worth pinning
// are: it asks the server (never guesses locally), it re-asks as the text
// changes, and it distinguishes "no match" from "no reference data at all".

const { resolveAircraftType } = vi.hoisted(() => ({ resolveAircraftType: vi.fn() }))
vi.mock('../../src/api.ts', () => ({ resolveAircraftType }))

import AircraftResolution from '../../src/components/AircraftResolution.vue'

const matched = {
	match: { code: 'B738', manufacturer: 'BOEING', model: '737-800' },
	referenceLoaded: true,
}
const noMatch = { match: null, referenceLoaded: true }
const noReference = { match: null, referenceLoaded: false }

/** Mount, then let the debounce fire and the request settle. */
async function settle(wrapper: ReturnType<typeof mount>) {
	await vi.advanceTimersByTimeAsync(300)
	await flushPromises()
	return wrapper
}

describe('AircraftResolution', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.clearAllMocks()
		resolveAircraftType.mockResolvedValue(matched)
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('reports the designator and model a match resolves to', async () => {
		const wrapper = mount(AircraftResolution, { props: { raw: 'B738' } })
		await settle(wrapper)

		expect(resolveAircraftType).toHaveBeenCalledWith('B738')
		expect(wrapper.text()).toContain('B738')
		expect(wrapper.text()).toContain('BOEING 737-800')
	})

	// The two miss messages share the "No aircraft reference data" prefix, so
	// these assert on the distinguishing tail — a prefix match would pass for
	// either state and stop telling them apart.
	it('reports a genuine miss', async () => {
		resolveAircraftType.mockResolvedValue(noMatch)
		const wrapper = mount(AircraftResolution, { props: { raw: 'mystery jet' } })
		await settle(wrapper)

		expect(wrapper.text()).toContain('No aircraft reference data match.')
	})

	/**
	 * A bare "no match" would be misleading on an instance that simply has no
	 * aircraft data loaded — nothing the user types could ever match.
	 */
	it('distinguishes an empty reference table from a genuine miss', async () => {
		resolveAircraftType.mockResolvedValue(noReference)
		const wrapper = mount(AircraftResolution, { props: { raw: 'B738' } })
		await settle(wrapper)

		expect(wrapper.text()).toContain('on this instance')
		expect(wrapper.text()).not.toContain('data match.')
	})

	it('says nothing and asks nothing while the field is empty', async () => {
		const wrapper = mount(AircraftResolution, { props: { raw: null } })
		await settle(wrapper)

		expect(resolveAircraftType).not.toHaveBeenCalled()
		expect(wrapper.text().trim()).toBe('')
	})

	it('re-checks when the text changes', async () => {
		const wrapper = mount(AircraftResolution, { props: { raw: 'B738' } })
		await settle(wrapper)

		resolveAircraftType.mockResolvedValue({
			match: { code: 'B77W', manufacturer: 'BOEING', model: '777-300ER' },
			referenceLoaded: true,
		})
		await wrapper.setProps({ raw: 'B77W' })
		await settle(wrapper)

		expect(wrapper.text()).toContain('777-300ER')
	})

	it('debounces rather than querying on every keystroke', async () => {
		const wrapper = mount(AircraftResolution, { props: { raw: 'B' } })
		await wrapper.setProps({ raw: 'B7' })
		await wrapper.setProps({ raw: 'B73' })
		await wrapper.setProps({ raw: 'B738' })
		await settle(wrapper)

		expect(resolveAircraftType).toHaveBeenCalledTimes(1)
		expect(resolveAircraftType).toHaveBeenCalledWith('B738')
	})

	/**
	 * Clearing the field must also cancel an in-flight result, or a stale match
	 * lands under an empty input.
	 */
	it('drops an in-flight result when the field is cleared', async () => {
		let release: (v: unknown) => void = () => {}
		resolveAircraftType.mockReturnValue(new Promise((r) => { release = r }))
		const wrapper = mount(AircraftResolution, { props: { raw: 'B738' } })
		await vi.advanceTimersByTimeAsync(300)

		await wrapper.setProps({ raw: null })
		release(matched)
		await flushPromises()

		expect(wrapper.text().trim()).toBe('')
	})

	it('reports a failed lookup rather than implying no match', async () => {
		resolveAircraftType.mockRejectedValue(new Error('offline'))
		const wrapper = mount(AircraftResolution, { props: { raw: 'B738' } })
		await settle(wrapper)

		expect(wrapper.text()).toContain('Could not check')
	})
})
