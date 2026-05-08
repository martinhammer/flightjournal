<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import { showError } from '@nextcloud/dialogs'
import { useFlightsStore } from '../store/flights.ts'
import type { Flight } from '../types.ts'

const router = useRouter()
const store = useFlightsStore()

onMounted(() => { if (!store.loaded) store.fetchAll() })

function route(f: Flight): string {
	const o = f.originCode || f.originLabel || '?'
	const d = f.destinationCode || f.destinationLabel || '?'
	return `${o} → ${d}`
}

function flightNo(f: Flight): string {
	if (!f.airlineCode && !f.flightNumber) return ''
	return `${f.airlineCode ?? ''}${f.flightNumber ?? ''}`
}

function edit(f: Flight) {
	router.push(`/edit/${f.id}`)
}

async function remove(f: Flight) {
	if (!confirm('Delete this flight?')) return
	try {
		await store.remove(f.id)
	} catch {
		showError('Failed to delete flight')
	}
}
</script>

<template>
	<div class="view-flight">
		<div class="header">
			<h2>Flight log</h2>
			<NcButton type="primary" @click="router.push('/edit')">
				Add flight
			</NcButton>
		</div>
		<div v-if="store.loading && !store.loaded" class="loader">
			<NcLoadingIcon />
		</div>
		<NcEmptyContent
			v-else-if="store.loaded && store.flights.length === 0"
			name="No flights yet"
			description="Add your first flight to get started." />
		<table v-else class="flight-table">
			<thead>
				<tr>
					<th>Date</th>
					<th>Flight</th>
					<th>Route</th>
					<th>Aircraft</th>
					<th>Reg.</th>
					<th>Cabin</th>
					<th>Seat</th>
					<th />
				</tr>
			</thead>
			<tbody>
				<tr v-for="f in store.flights" :key="f.id">
					<td>{{ f.flightDate }}</td>
					<td>{{ flightNo(f) }}</td>
					<td>{{ route(f) }}</td>
					<td>{{ f.aircraftTypeRaw ?? f.aircraftTypeCode ?? '' }}</td>
					<td>{{ f.registration ?? '' }}</td>
					<td>{{ f.cabinClass ?? '' }}</td>
					<td>{{ f.seat ?? '' }}</td>
					<td class="actions">
						<NcButton @click="edit(f)">
							Edit
						</NcButton>
						<NcButton type="tertiary" @click="remove(f)">
							Delete
						</NcButton>
					</td>
				</tr>
			</tbody>
		</table>
	</div>
</template>

<style scoped>
.view-flight {
	padding: 16px;
}

.header {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 16px;
}

.loader {
	display: flex;
	justify-content: center;
	padding: 32px;
}

.flight-table {
	width: 100%;
	border-collapse: collapse;
}

.flight-table th,
.flight-table td {
	padding: 8px;
	text-align: start;
	border-bottom: 1px solid var(--color-border);
}

.actions {
	display: flex;
	gap: 4px;
}
</style>
