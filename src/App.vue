<script setup lang="ts">
import NcAppContent from '@nextcloud/vue/components/NcAppContent'
import NcAppNavigation from '@nextcloud/vue/components/NcAppNavigation'
import NcAppNavigationItem from '@nextcloud/vue/components/NcAppNavigationItem'
import NcContent from '@nextcloud/vue/components/NcContent'

const items = [
	{ to: '/edit', label: 'Edit flight log' },
	{ to: '/view', label: 'View flight log' },
	{ to: '/map', label: 'Map' },
	{ to: '/analytics', label: 'Analytics' },
]
</script>

<template>
	<NcContent app-name="flightjournal">
		<NcAppNavigation>
			<template #list>
				<NcAppNavigationItem
					v-for="item in items"
					:key="item.to"
					:name="item.label"
					:to="item.to" />
			</template>
		</NcAppNavigation>
		<NcAppContent>
			<RouterView />
		</NcAppContent>
	</NcContent>
</template>
