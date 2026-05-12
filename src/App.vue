<script setup lang="ts">
import { ref } from 'vue'
import NcAppContent from '@nextcloud/vue/components/NcAppContent'
import NcAppNavigation from '@nextcloud/vue/components/NcAppNavigation'
import NcAppNavigationItem from '@nextcloud/vue/components/NcAppNavigationItem'
import NcAppNavigationNew from '@nextcloud/vue/components/NcAppNavigationNew'
import NcContent from '@nextcloud/vue/components/NcContent'
import Plus from 'vue-material-design-icons/Plus.vue'
import AddFlightDialog from './views/AddFlightDialog.vue'

const items = [
	{ to: '/flights', label: 'Flights' },
	{ to: '/map', label: 'Map' },
	{ to: '/analytics', label: 'Analytics' },
	{ to: '/airports', label: 'Airports' },
]

const addOpen = ref(false)
</script>

<template>
	<NcContent app-name="flightjournal">
		<NcAppNavigation>
			<template #list>
				<NcAppNavigationNew text="Add flight" @click="addOpen = true">
					<template #icon>
						<Plus :size="20" />
					</template>
				</NcAppNavigationNew>
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
		<AddFlightDialog :open="addOpen" @update:open="addOpen = $event" />
	</NcContent>
</template>
