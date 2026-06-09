import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// Covers the JSON backup/restore wiring added alongside the legacy markdown
// import/export: restore POSTs the file contents with dataformat 'json', and
// the download button GETs the JSON export endpoint.

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))

vi.mock('@nextcloud/axios', () => ({ default: { get, post, delete: vi.fn() } }))

import PersonalSettings from '../../src/views/PersonalSettings.vue'

// Slot-rendering NcButton so we can click controls by their label text.
const NcButton = {
	emits: ['click'],
	template: '<button class="nc-button" @click="$emit(\'click\')"><slot /></button>',
}

// Slot-rendering switch so the "Replace existing database" toggle is operable.
const NcCheckboxRadioSwitch = {
	props: ['modelValue'],
	emits: ['update:modelValue'],
	template: '<button class="switch" @click="$emit(\'update:modelValue\', !modelValue)"><slot /></button>',
}

// Render the dialog body and its actions slot only when open, mirroring NcDialog.
const NcDialog = {
	props: ['open'],
	template: '<div v-if="open" class="dialog"><slot /><slot name="actions" /></div>',
}

const NcTextArea = {
	props: ['modelValue'],
	emits: ['update:modelValue'],
	template: '<textarea class="md-content" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
}

const stubs = {
	NcButton,
	NcCheckboxRadioSwitch,
	NcDialog,
	NcTextArea,
	NcSettingsSection: { template: '<div><slot /></div>' },
	NcNoteCard: { template: '<div><slot /></div>' },
}

function switchByText(wrapper: ReturnType<typeof mount>, text: string) {
	return wrapper.findAll('button.switch').find((b) => b.text() === text)!
}

function buttonByText(wrapper: ReturnType<typeof mount>, text: string) {
	return wrapper.findAll('button.nc-button').find((b) => b.text() === text)!
}

describe('PersonalSettings JSON backup/restore', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		post.mockResolvedValue({ data: { ocs: { data: { imported: 2, skipped: [] } } } })
		get.mockResolvedValue({ data: new Blob(['{}'], { type: 'application/json' }) })
		// jsdom lacks the object-URL helpers used by the download path.
		globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock')
		globalThis.URL.revokeObjectURL = vi.fn()
	})

	it('restores from a JSON file with dataformat json', async () => {
		const wrapper = mount(PersonalSettings, { global: { stubs } })

		const file = new File(['{"flights":[]}'], 'backup.json', { type: 'application/json' })
		const input = wrapper.find('input[type="file"]')
		Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
		await input.trigger('change')

		await buttonByText(wrapper, 'Restore from JSON').trigger('click')
		await flushPromises()

		expect(post).toHaveBeenCalledTimes(1)
		const [url, body] = post.mock.calls[0]
		expect(url).toContain('/api/v1/import')
		// Appends by default — replace flag is off.
		expect(body).toEqual({ dataformat: 'json', content: '{"flights":[]}', replace: false })
	})

	it('sends replace:true when the toggle is enabled', async () => {
		const wrapper = mount(PersonalSettings, { global: { stubs } })

		const file = new File(['{"flights":[]}'], 'backup.json', { type: 'application/json' })
		const input = wrapper.find('input[type="file"]')
		Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
		await input.trigger('change')

		await switchByText(wrapper, 'Replace existing database').trigger('click')
		await buttonByText(wrapper, 'Restore from JSON').trigger('click')
		await flushPromises()

		// showConfirmation is mocked to resolve true in setup.ts, so the import proceeds.
		expect(post).toHaveBeenCalledTimes(1)
		expect(post.mock.calls[0][1]).toMatchObject({ replace: true })
	})

	it('downloads the JSON export from the json endpoint', async () => {
		const wrapper = mount(PersonalSettings, { global: { stubs } })

		await buttonByText(wrapper, 'Download JSON').trigger('click')
		await flushPromises()

		expect(get).toHaveBeenCalledTimes(1)
		expect(get.mock.calls[0][0]).toContain('dataformat=json')
	})

	it('imports markdown from the popup dialog with dataformat markdown', async () => {
		const wrapper = mount(PersonalSettings, { global: { stubs } })

		// The textarea lives in the dialog, which is closed until the button opens it.
		expect(wrapper.find('textarea.md-content').exists()).toBe(false)
		await buttonByText(wrapper, 'Import from markdown…').trigger('click')

		await wrapper.find('textarea.md-content').setValue('| 2026/04/26 | BA117 | LHR-JFK | B777 | G-STBM |')
		await buttonByText(wrapper, 'Import').trigger('click')
		await flushPromises()

		expect(post).toHaveBeenCalledTimes(1)
		const [url, body] = post.mock.calls[0]
		expect(url).toContain('/api/v1/import')
		expect(body).toMatchObject({ dataformat: 'markdown' })
		expect(body).not.toHaveProperty('replace')
	})
})
