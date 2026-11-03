import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SortMenu from '../../src/components/SortMenu.vue'

// The card layout's stand-in for the sortable header row. It only reports the
// picked column; the view's setSort owns the direction (covered in
// ViewFlightLog.spec.ts).

const NcActions = {
	props: ['menuName'],
	template: '<div class="sort-actions" :data-menu-name="menuName"><slot /></div>',
}
const NcActionButton = {
	props: ['type', 'modelValue', 'value', 'description'],
	emits: ['click'],
	template: '<button class="sort-item" :data-checked="modelValue === value" :data-description="description" @click="$emit(\'click\')"><slot /></button>',
}

const columns = [
	{ key: 'date', label: 'Date', defaultDir: 'desc' as const, ascLabel: 'Oldest first', descLabel: 'Newest first' },
	{ key: 'route', label: 'Route' },
]

function render(sortKey = 'date', sortDir: 'asc' | 'desc' = 'desc') {
	return mount(SortMenu, {
		props: { columns, sortKey, sortDir },
		global: { stubs: { NcActions, NcActionButton, SortIcon: true } },
	})
}

describe('SortMenu', () => {
	it('offers one radio item per column, checking the active one', () => {
		const items = render().findAll('.sort-item')
		expect(items.map((i) => i.text())).toEqual(['Date', 'Route'])
		expect(items.map((i) => i.attributes('data-checked'))).toEqual(['true', 'false'])
	})

	it('emits the picked column', async () => {
		const wrapper = render()
		await wrapper.findAll('.sort-item')[1].trigger('click')
		expect(wrapper.emitted('sort')).toEqual([['route']])
	})

	it('emits the active column again when it is re-picked, so the view can flip it', async () => {
		const wrapper = render()
		await wrapper.findAll('.sort-item')[0].trigger('click')
		expect(wrapper.emitted('sort')).toEqual([['date']])
	})

	it('names the active sort and its direction in words', () => {
		const wrapper = render('date', 'asc')
		expect(wrapper.find('.sort-actions').attributes('data-menu-name')).toBe('Date, oldest first')
		const [date, route] = wrapper.findAll('.sort-item')
		expect(date.attributes('data-description')).toBe('Oldest first · click again to reverse')
		// An inactive column says which way a first pick sorts it.
		expect(route.attributes('data-description')).toBe('A to Z')
	})
})
