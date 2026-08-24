import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// Covers the two reconcile actions in Personal settings → Maintenance. They
// share one runner, so what matters is that each button carries its own
// endpoint and its own toggles — a crossed wire would silently run the wrong
// reconciliation or drop an option the user switched on.

const { get, post, del } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn() }))

vi.mock('@nextcloud/axios', () => ({ default: { get, post, delete: del } }))

import PersonalSettings from '../../src/views/PersonalSettings.vue'

const NcButton = {
	props: ['disabled'],
	emits: ['click'],
	template: '<button class="nc-button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
}

const NcCheckboxRadioSwitch = {
	props: ['modelValue'],
	emits: ['update:modelValue'],
	template: '<button class="switch" @click="$emit(\'update:modelValue\', !modelValue)"><slot /></button>',
}

const stubs = {
	NcButton,
	NcCheckboxRadioSwitch,
	NcSettingsSection: { template: '<section><slot /></section>' },
	NcNoteCard: { template: '<div><slot /></div>' },
	NcDialog: { props: ['open'], template: '<div v-if="open"><slot /><slot name="actions" /></div>' },
	NcTextArea: { template: '<textarea />' },
}

function buttonByText(wrapper: ReturnType<typeof mount>, text: string) {
	return wrapper.findAll('button.nc-button').find((b) => b.text() === text)!
}

function switchByText(wrapper: ReturnType<typeof mount>, text: string) {
	return wrapper.findAll('button.switch').find((b) => b.text() === text)!
}

const ALL_FLIGHTS = 'Re-check all flights (otherwise only flights with no match yet)'
const IGNORE_PUNCT = 'Ignore punctuation when matching model names'

describe('PersonalSettings reconcile actions', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		get.mockResolvedValue({ data: new Blob(['{}']) })
		post.mockResolvedValue({
			data: { ocs: { data: { flights: 200, updated: 175, matched: 175, unmatched: 25 } } },
		})
	})

	it('sends the aircraft reconcile to its own endpoint', async () => {
		const wrapper = mount(PersonalSettings, { global: { stubs } })
		await buttonByText(wrapper, 'Reconcile aircraft types').trigger('click')
		await flushPromises()

		const [url, body] = post.mock.calls[0]
		expect(url).toContain('/api/v1/flights/reconcile-aircraft')
		expect(body).toEqual({ scope: 'missing', ignorePunctuation: false })
	})

	it('sends the airport reconcile to its own endpoint, without aircraft options', async () => {
		const wrapper = mount(PersonalSettings, { global: { stubs } })
		await buttonByText(wrapper, 'Reconcile airports').trigger('click')
		await flushPromises()

		const [url, body] = post.mock.calls[0]
		expect(url).toContain('/api/v1/flights/reconcile')
		expect(url).not.toContain('reconcile-aircraft')
		expect(body).toEqual({ scope: 'missing' })
	})

	it('carries the ignore-punctuation switch into the request', async () => {
		const wrapper = mount(PersonalSettings, { global: { stubs } })
		await switchByText(wrapper, IGNORE_PUNCT).trigger('click')
		await buttonByText(wrapper, 'Reconcile aircraft types').trigger('click')
		await flushPromises()

		expect(post.mock.calls[0][1]).toEqual({ scope: 'missing', ignorePunctuation: true })
	})

	it('keeps the two scope switches independent', async () => {
		const wrapper = mount(PersonalSettings, { global: { stubs } })
		// There is one "re-check all" switch per section; the aircraft one is second.
		const aircraftScope = wrapper.findAll('button.switch').filter((b) => b.text() === ALL_FLIGHTS)[1]
		await aircraftScope.trigger('click')

		await buttonByText(wrapper, 'Reconcile airports').trigger('click')
		await flushPromises()
		expect(post.mock.calls[0][1]).toEqual({ scope: 'missing' })

		await buttonByText(wrapper, 'Reconcile aircraft types').trigger('click')
		await flushPromises()
		expect(post.mock.calls[1][1]).toEqual({ scope: 'all', ignorePunctuation: false })
	})
})
