<script setup lang="ts">
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import ReferenceDataSection from '../components/ReferenceDataSection.vue'
</script>

<template>
	<div>
		<ReferenceDataSection
			name="Airport reference data"
			description="Instance-wide airport master data shared by all users. Imported data is keyed by ICAO code; existing entries are updated."
			base-path="/api/v1/admin/airports"
			accept="application/json,.json"
			choose-prompt="Choose JSON file…"
			import-label="Import airports"
			entity="airport"
			entity-plural="airports">
			<template #instructions>
				<NcNoteCard type="info" class="instructions">
					<p>Upload a JSON file containing an object keyed by ICAO code, e.g.:</p>
					<code>{ "KOSH": { "icao": "KOSH", "iata": "OSH", "name": "Wittman Regional", "lat": 43.98, "lon": -88.55, "tz": "America/Chicago", ... } }</code>
				</NcNoteCard>
				<NcNoteCard type="info" class="instructions">
					<p>
						The <a href="https://github.com/mwgg/Airports" target="_blank" rel="noopener noreferrer">mwgg/Airports</a>
						dataset is the standard reference set for this format and can be imported as-is.
					</p>
				</NcNoteCard>
			</template>
		</ReferenceDataSection>

		<ReferenceDataSection
			name="Aircraft type reference data"
			description="Instance-wide aircraft master data shared by all users. One row per model; models sharing an ICAO type designator are all kept."
			base-path="/api/v1/admin/aircraft-types"
			accept="text/csv,.csv"
			choose-prompt="Choose CSV file…"
			import-label="Import aircraft types"
			entity="aircraft type"
			entity-plural="aircraft types">
			<template #instructions>
				<NcNoteCard type="info" class="instructions">
					<p>Upload the ICAO DOC 8643 CSV export, with this header row:</p>
					<code>manufacturer,model,type_designator,description,engine_type,engine_count,wtc</code>
					<p>Column order does not matter, but manufacturer, model and type_designator are required.</p>
				</NcNoteCard>
				<NcNoteCard type="info" class="instructions">
					<p>
						The <a href="https://github.com/ColtJD45/icao-aircraft-designator-list" target="_blank" rel="noopener noreferrer">ColtJD45/icao-aircraft-designator-list</a> CSV can be imported exactly as downloaded.
					</p>
					<p>
						About half of all type designators cover more than one model, e.g. B738 is both
						the 737-800 and the 737-800 BBJ2. Every model is stored, and one per
						designator is marked as the "default" that a bare code resolves to.
					</p>
				</NcNoteCard>
			</template>
		</ReferenceDataSection>
	</div>
</template>

<style scoped>
/*
 * Slot content is compiled in this component's scope, so the notes passed into
 * ReferenceDataSection's `instructions` slot are styled here rather than there.
 */
.instructions {
	margin-bottom: 12px;
}

.instructions p {
	margin: 0 0 4px 0;
}

.instructions code {
	display: block;
	font-size: 0.85em;
	word-break: break-all;
	white-space: pre-wrap;
}

.instructions a {
	text-decoration: underline;
}
</style>
