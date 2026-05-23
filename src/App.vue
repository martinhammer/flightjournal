<script setup lang="ts">
import { ref } from 'vue'
import NcAppContent from '@nextcloud/vue/components/NcAppContent'
import NcAppNavigation from '@nextcloud/vue/components/NcAppNavigation'
import NcAppNavigationItem from '@nextcloud/vue/components/NcAppNavigationItem'
import NcAppNavigationNew from '@nextcloud/vue/components/NcAppNavigationNew'
import NcAppNavigationSettings from '@nextcloud/vue/components/NcAppNavigationSettings'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcContent from '@nextcloud/vue/components/NcContent'
import Plus from 'vue-material-design-icons/Plus.vue'
import AddFlightDialog from './views/AddFlightDialog.vue'
import { PROJECTIONS, useMapSettingsStore } from './store/mapSettings.ts'

const items = [
	{ to: '/flights', label: 'Flights' },
	{ to: '/map', label: 'Map' },
	{ to: '/analytics', label: 'Analytics' },
	{ to: '/airports', label: 'Airports' },
]

const addOpen = ref(false)
const mapSettings = useMapSettingsStore()
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
			<template #footer>
				<NcAppNavigationSettings name="Settings">
					<section class="settings-section">
						<h3 class="settings-heading">
							Map projection
						</h3>
						<NcCheckboxRadioSwitch
							v-for="p in PROJECTIONS"
							:key="p.id"
							:model-value="mapSettings.projection"
							:value="p.id"
							name="map-projection"
							type="radio"
							@update:model-value="mapSettings.projection = p.id">
							{{ p.label }}
						</NcCheckboxRadioSwitch>
					</section>
				</NcAppNavigationSettings>
			</template>
		</NcAppNavigation>
		<NcAppContent>
			<RouterView />
		</NcAppContent>
		<AddFlightDialog :open="addOpen" @update:open="addOpen = $event" />
	</NcContent>
</template>

<style scoped>
.settings-section {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.settings-heading {
	margin: 0 0 4px;
	font-size: 0.9em;
	color: var(--color-text-maxcontrast);
}
</style>
