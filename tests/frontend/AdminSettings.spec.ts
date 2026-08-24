import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// Covers the admin reference-data wiring. Both tables are driven by the same
// ReferenceDataSection component, so the thing worth pinning down is that each
// instance is aimed at its own endpoints — a wrong base path would silently
// import aircraft into the airport table (or wipe the wrong one).

const { get, post, del } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn() }))

vi.mock('@nextcloud/axios', () => ({ default: { get, post, delete: del } }))

import { showConfirmation } from '@nextcloud/dialogs'
import AdminSettings from '../../src/views/AdminSettings.vue'

const NcButton = {
	props: ['disabled'],
	emits: ['click'],
	template: '<button class="nc-button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
}

const stubs = {
	NcButton,
	NcSettingsSection: { template: '<section><slot /></section>' },
	NcNoteCard: { template: '<div><slot /></div>' },
}

function buttonByText(wrapper: ReturnType<typeof mount>, text: string) {
	return wrapper.findAll('button.nc-button').find((b) => b.text() === text)!
}

/** Drive the hidden file input the way the picker button does. */
async function pickFile(wrapper: ReturnType<typeof mount>, index: number, contents: string, name: string) {
	const input = wrapper.findAll('input[type="file"]')[index]
	const file = new File([contents], name)
	// jsdom won't let us assign `files` directly, so define it on the element.
	Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
	await input.trigger('change')
}

describe('AdminSettings reference data', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		get.mockResolvedValue({ data: { ocs: { data: { count: 0 } } } })
		post.mockResolvedValue({ data: { ocs: { data: { imported: 3, updated: 0, skipped: [] } } } })
		del.mockResolvedValue({ data: { ocs: { data: { deleted: 5 } } } })
		vi.mocked(showConfirmation).mockResolvedValue(true)
	})

	it('loads a count for each reference table on mount', async () => {
		mount(AdminSettings, { global: { stubs } })
		await flushPromises()

		const urls = get.mock.calls.map((c) => c[0])
		expect(urls.some((u: string) => u.includes('/api/v1/admin/airports/count'))).toBe(true)
		expect(urls.some((u: string) => u.includes('/api/v1/admin/aircraft-types/count'))).toBe(true)
	})

	it('posts a chosen CSV to the aircraft import endpoint', async () => {
		const wrapper = mount(AdminSettings, { global: { stubs } })
		await flushPromises()

		const csv = 'manufacturer,model,type_designator\nBOEING,737-800,B738\n'
		await pickFile(wrapper, 1, csv, 'aircraft.csv')
		await buttonByText(wrapper, 'Import aircraft types').trigger('click')
		await flushPromises()

		expect(post).toHaveBeenCalledTimes(1)
		const [url, body] = post.mock.calls[0]
		expect(url).toContain('/api/v1/admin/aircraft-types/import')
		expect(body).toEqual({ content: csv })
	})

	it('posts a chosen JSON file to the airport import endpoint', async () => {
		const wrapper = mount(AdminSettings, { global: { stubs } })
		await flushPromises()

		const json = '{"KOSH":{"icao":"KOSH"}}'
		await pickFile(wrapper, 0, json, 'airports.json')
		await buttonByText(wrapper, 'Import airports').trigger('click')
		await flushPromises()

		expect(post.mock.calls[0][0]).toContain('/api/v1/admin/airports/import')
	})

	it('will not import until a file is chosen', async () => {
		const wrapper = mount(AdminSettings, { global: { stubs } })
		await flushPromises()

		expect(buttonByText(wrapper, 'Import aircraft types').attributes('disabled')).toBeDefined()
		expect(post).not.toHaveBeenCalled()
	})

	it('deletes only the aircraft table, and only after confirmation', async () => {
		const wrapper = mount(AdminSettings, { global: { stubs } })
		await flushPromises()

		await buttonByText(wrapper, 'Delete all aircraft types').trigger('click')
		await flushPromises()

		expect(showConfirmation).toHaveBeenCalledTimes(1)
		expect(del).toHaveBeenCalledTimes(1)
		const url = del.mock.calls[0][0] as string
		expect(url).toContain('/api/v1/admin/aircraft-types')
		expect(url).not.toContain('/airports')
	})

	it('does not delete when the confirmation is declined', async () => {
		vi.mocked(showConfirmation).mockResolvedValue(false)
		const wrapper = mount(AdminSettings, { global: { stubs } })
		await flushPromises()

		await buttonByText(wrapper, 'Delete all airports').trigger('click')
		await flushPromises()

		expect(del).not.toHaveBeenCalled()
	})
})
