<script setup lang="ts">
import { onMounted, ref, useTemplateRef } from 'vue'
import axios from '@nextcloud/axios'
import { generateOcsUrl } from '@nextcloud/router'
import { showConfirmation, showError, showSuccess } from '@nextcloud/dialogs'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcSettingsSection from '@nextcloud/vue/components/NcSettingsSection'

interface SkippedRow { key: string; reason: string }
interface ImportResult { imported: number; updated: number; skipped: SkippedRow[] }

const ocsUrl = (path: string) => {
	const base = generateOcsUrl('apps/flightjournal' + path)
	return base.includes('?') ? `${base}&format=json` : `${base}?format=json`
}
const ocsConfig = {
	headers: {
		'OCS-APIRequest': 'true',
		Accept: 'application/json',
	},
}

const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const selectedFile = ref<File | null>(null)
const importing = ref(false)
const deleting = ref(false)
const lastResult = ref<ImportResult | null>(null)
const airportCount = ref<number | null>(null)

async function refreshCount() {
	try {
		const res = await axios.get<{ ocs: { data: { count: number } } }>(
			ocsUrl('/api/v1/admin/airports/count'),
			ocsConfig,
		)
		airportCount.value = res.data.ocs.data.count
	} catch {
		airportCount.value = null
	}
}

onMounted(refreshCount)

function onFilePick() {
	fileInput.value?.click()
}

function onFileChange(event: Event) {
	const target = event.target as HTMLInputElement
	selectedFile.value = target.files?.[0] ?? null
}

function extractImportResult(payload: unknown): ImportResult | null {
	const p = payload as { ocs?: { data?: unknown }; data?: unknown } | null | undefined
	const candidates: unknown[] = [p, p?.ocs?.data, p?.data]
	for (const c of candidates) {
		if (c && typeof c === 'object'
			&& typeof (c as Record<string, unknown>).imported === 'number'
			&& typeof (c as Record<string, unknown>).updated === 'number'
			&& Array.isArray((c as Record<string, unknown>).skipped)) {
			return c as ImportResult
		}
	}
	return null
}

async function runImport() {
	if (!selectedFile.value) {
		showError('Pick a JSON file first.')
		return
	}
	importing.value = true
	lastResult.value = null
	let content: string
	try {
		content = await selectedFile.value.text()
	} catch {
		showError('Could not read the selected file.')
		importing.value = false
		return
	}
	let payload: unknown = null
	try {
		const res = await axios.post(
			ocsUrl('/api/v1/admin/airports/import'),
			{ content },
			ocsConfig,
		)
		payload = res.data
	} catch (e: unknown) {
		const message = (e as { response?: { data?: { ocs?: { meta?: { message?: string } } } } })
			?.response?.data?.ocs?.meta?.message ?? 'Airport import failed'
		showError(message)
		importing.value = false
		return
	}
	importing.value = false
	const result = extractImportResult(payload)
	if (!result) {
		console.error('[FlightJournal] Unexpected airport import response:', payload)
		showError('Import returned an unexpected response from the server. See the browser console for details.')
		return
	}
	lastResult.value = result
	const { imported, updated, skipped } = result
	showSuccess(`Imported ${imported}, updated ${updated}, skipped ${skipped.length}.`)
	selectedFile.value = null
	if (fileInput.value) fileInput.value.value = ''
	refreshCount()
}

async function runDeleteAll() {
	const confirmed = await showConfirmation({
		name: 'Delete all airports',
		text: 'This will permanently delete every airport record on this Nextcloud instance for all users. This action cannot be undone.',
		labelConfirm: 'Delete all',
		labelReject: 'Cancel',
		severity: 'warning',
	})
	if (!confirmed) return
	deleting.value = true
	try {
		const res = await axios.delete<{ ocs: { data: { deleted: number } } }>(
			ocsUrl('/api/v1/admin/airports'),
			ocsConfig,
		)
		const deleted = res.data.ocs.data.deleted
		showSuccess(`Deleted ${deleted} airport${deleted === 1 ? '' : 's'}.`)
		refreshCount()
	} catch {
		showError('Failed to delete airports')
	} finally {
		deleting.value = false
	}
}
</script>

<template>
	<NcSettingsSection
		name="Airport reference data"
		description="Instance-wide airport master data shared by all users. Imported data is keyed by ICAO code; existing entries are updated.">
		<p v-if="airportCount === null" class="status">
			Loading current record count…
		</p>
		<p v-else class="status">
			Currently <strong>{{ airportCount }}</strong> airport{{ airportCount === 1 ? '' : 's' }} stored.
		</p>

		<h3>Import</h3>
		<NcNoteCard type="info" class="instructions">
			<p>Upload a JSON file containing an object keyed by ICAO code, e.g.:</p>
			<code>{ "KOSH": { "icao": "KOSH", "iata": "OSH", "name": "Wittman Regional", "lat": 43.98, "lon": -88.55, "tz": "America/Chicago", ... } }</code>
		</NcNoteCard>
		<input
			ref="fileInput"
			type="file"
			accept="application/json,.json"
			class="hidden-file-input"
			@change="onFileChange">
		<div class="actions">
			<NcButton variant="secondary" :disabled="importing" @click="onFilePick">
				{{ selectedFile ? selectedFile.name : 'Choose JSON file…' }}
			</NcButton>
			<NcButton variant="primary" :disabled="importing || !selectedFile" @click="runImport">
				Import airports
			</NcButton>
		</div>
		<NcNoteCard v-if="lastResult" type="success" class="result">
			<p>
				Imported <strong>{{ lastResult.imported }}</strong>, updated <strong>{{ lastResult.updated }}</strong>, skipped <strong>{{ lastResult.skipped.length }}</strong>.
			</p>
			<details v-if="lastResult.skipped.length">
				<summary>Skipped entries</summary>
				<ul>
					<li v-for="row in lastResult.skipped" :key="row.key">
						<code>{{ row.key }}</code>: {{ row.reason }}
					</li>
				</ul>
			</details>
		</NcNoteCard>

		<h3 class="danger-heading">
			Delete
		</h3>
		<NcNoteCard type="warning" class="instructions">
			<p>This will delete every airport record from the shared reference table.</p>
		</NcNoteCard>
		<div class="actions">
			<NcButton variant="error" :disabled="deleting" @click="runDeleteAll">
				Delete all airports
			</NcButton>
		</div>
	</NcSettingsSection>
</template>

<style scoped>
.status {
	display: block;
	width: 100%;
	margin: 0 0 12px;
	color: var(--color-text-maxcontrast);
}

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

.actions {
	display: flex;
	gap: 8px;
	margin-top: 12px;
	align-items: center;
}

.result {
	margin-top: 16px;
}

.danger-heading {
	margin-top: 24px;
}

.hidden-file-input {
	display: none;
}
</style>
