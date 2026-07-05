<script setup lang="ts">
import { ref } from 'vue'
import axios from '@nextcloud/axios'
import { generateOcsUrl } from '@nextcloud/router'
import { showConfirmation, showError, showSuccess } from '@nextcloud/dialogs'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcSettingsSection from '@nextcloud/vue/components/NcSettingsSection'
import NcTextArea from '@nextcloud/vue/components/NcTextArea'

interface SkippedRow { line: number; reason: string; raw: string }
interface ImportResult { imported: number; skipped: SkippedRow[]; deleted?: number }

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

const exportFilename = (ext: string) => {
	const now = new Date()
	const y = now.getFullYear()
	const m = String(now.getMonth() + 1).padStart(2, '0')
	const d = String(now.getDate()).padStart(2, '0')
	return `flightjournal-export-${y}-${m}-${d}.${ext}`
}

const importContent = ref('')
const importing = ref(false)
const markdownDialogOpen = ref(false)
const lastResult = ref<ImportResult | null>(null)
const exporting = ref(false)
const jsonFileInput = ref<HTMLInputElement | null>(null)
const selectedJsonFile = ref<File | null>(null)
const replaceExisting = ref(false)
const importingJson = ref(false)
const lastJsonResult = ref<ImportResult | null>(null)
const exportingJson = ref(false)
const deleting = ref(false)
const reconciling = ref(false)
const reconcileAllFlights = ref(false)

interface ReconcileResult { flights: number; updated: number; matched: number; unmatched: number }

function extractImportResult(payload: unknown): ImportResult | null {
	const candidates: unknown[] = []
	const p = payload as Record<string, unknown> | null | undefined
	candidates.push(p)
	candidates.push(p?.ocs && (p.ocs as Record<string, unknown>).data)
	candidates.push(p?.data)
	for (const c of candidates) {
		if (c && typeof c === 'object'
			&& typeof (c as Record<string, unknown>).imported === 'number'
			&& Array.isArray((c as Record<string, unknown>).skipped)) {
			return c as ImportResult
		}
	}
	return null
}

async function runImport() {
	if (!importContent.value.trim()) {
		showError('Paste a markdown table to import.')
		return
	}
	importing.value = true
	lastResult.value = null
	let payload: unknown = null
	try {
		const res = await axios.post(
			ocsUrl('/api/v1/import'),
			{ dataformat: 'markdown', content: importContent.value },
			ocsConfig,
		)
		payload = res.data
	} catch (e: unknown) {
		const message = (e as { response?: { data?: { ocs?: { meta?: { message?: string } } } } })
			?.response?.data?.ocs?.meta?.message ?? 'Import failed'
		showError(message)
		importing.value = false
		return
	}
	importing.value = false
	const result = extractImportResult(payload)
	if (!result) {
		console.error('[FlightJournal] Unexpected import response:', payload)
		showError('Import returned an unexpected response from the server. See the browser console for details.')
		return
	}
	lastResult.value = result
	// Close the dialog so the result card (and its skipped-row details) is visible
	// in the main view; keep the pasted content when rows were skipped so it can
	// be corrected and re-imported.
	markdownDialogOpen.value = false
	const { imported, skipped } = result
	if (skipped.length === 0) {
		showSuccess(`Imported ${imported} flight${imported === 1 ? '' : 's'}.`)
		importContent.value = ''
	} else {
		showSuccess(`Imported ${imported}, skipped ${skipped.length}.`)
	}
}

function onJsonFilePick() {
	jsonFileInput.value?.click()
}

function onJsonFileChange(event: Event) {
	const target = event.target as HTMLInputElement
	selectedJsonFile.value = target.files?.[0] ?? null
}

async function runJsonImport() {
	if (!selectedJsonFile.value) {
		showError('Choose a JSON file to import.')
		return
	}
	if (replaceExisting.value) {
		const confirmed = await showConfirmation({
			name: 'Replace existing database',
			text: 'This will permanently delete every flight in your journal and replace it '
				+ 'with the imported data. This action cannot be undone.',
			labelConfirm: 'Replace',
			labelReject: 'Cancel',
			severity: 'warning',
		})
		if (!confirmed) return
	}
	importingJson.value = true
	lastJsonResult.value = null
	let content: string
	try {
		content = await selectedJsonFile.value.text()
	} catch {
		showError('Could not read the selected file.')
		importingJson.value = false
		return
	}
	let payload: unknown = null
	try {
		const res = await axios.post(
			ocsUrl('/api/v1/import'),
			{ dataformat: 'json', content, replace: replaceExisting.value },
			ocsConfig,
		)
		payload = res.data
	} catch (e: unknown) {
		const message = (e as { response?: { data?: { ocs?: { meta?: { message?: string } } } } })
			?.response?.data?.ocs?.meta?.message ?? 'Import failed'
		showError(message)
		importingJson.value = false
		return
	}
	importingJson.value = false
	const result = extractImportResult(payload)
	if (!result) {
		console.error('[FlightJournal] Unexpected JSON import response:', payload)
		showError('Import returned an unexpected response from the server. See the browser console for details.')
		return
	}
	lastJsonResult.value = result
	const { imported, skipped } = result
	if (skipped.length === 0) {
		showSuccess(`Imported ${imported} flight${imported === 1 ? '' : 's'}.`)
		selectedJsonFile.value = null
		if (jsonFileInput.value) jsonFileInput.value.value = ''
	} else {
		showSuccess(`Imported ${imported}, skipped ${skipped.length}.`)
	}
}

async function runJsonExport() {
	exportingJson.value = true
	try {
		const res = await axios.get<Blob>(
			ocsUrl('/api/v1/export?dataformat=json'),
			{ ...ocsConfig, responseType: 'blob' },
		)
		const url = URL.createObjectURL(res.data)
		const a = document.createElement('a')
		a.href = url
		a.download = exportFilename('json')
		document.body.appendChild(a)
		a.click()
		document.body.removeChild(a)
		URL.revokeObjectURL(url)
	} catch {
		showError('Export failed')
	} finally {
		exportingJson.value = false
	}
}

async function runDeleteAll() {
	const confirmed = await showConfirmation({
		name: 'Delete all flights',
		text: 'This will permanently delete every flight in your journal. This action cannot be undone.',
		labelConfirm: 'Delete all',
		labelReject: 'Cancel',
		severity: 'warning',
	})
	if (!confirmed) return
	deleting.value = true
	try {
		const res = await axios.delete<{ ocs: { data: { deleted: number } } }>(
			ocsUrl('/api/v1/flights'),
			ocsConfig,
		)
		const deleted = res.data.ocs.data.deleted
		showSuccess(`Deleted ${deleted} flight${deleted === 1 ? '' : 's'}.`)
	} catch {
		showError('Failed to delete flights')
	} finally {
		deleting.value = false
	}
}

async function runReconcile() {
	reconciling.value = true
	try {
		const res = await axios.post<{ ocs: { data: ReconcileResult } }>(
			ocsUrl('/api/v1/flights/reconcile'),
			{ scope: reconcileAllFlights.value ? 'all' : 'missing' },
			ocsConfig,
		)
		const { flights, updated, matched, unmatched } = res.data.ocs.data
		showSuccess(`Checked ${flights} flight${flights === 1 ? '' : 's'}: `
			+ `${matched} airport${matched === 1 ? '' : 's'} matched, ${unmatched} unmatched, ${updated} updated.`)
	} catch {
		showError('Airport reconciliation failed')
	} finally {
		reconciling.value = false
	}
}

async function runExport() {
	exporting.value = true
	try {
		const res = await axios.get<Blob>(
			ocsUrl('/api/v1/export?dataformat=markdown'),
			{ ...ocsConfig, responseType: 'blob' },
		)
		const url = URL.createObjectURL(res.data)
		const a = document.createElement('a')
		a.href = url
		a.download = exportFilename('md')
		document.body.appendChild(a)
		a.click()
		document.body.removeChild(a)
		URL.revokeObjectURL(url)
	} catch {
		showError('Export failed')
	} finally {
		exporting.value = false
	}
}
</script>

<template>
	<div>
		<NcSettingsSection
			name="Import / Export"
			description="Back up, restore, or migrate your flights.">
			<h3>Import</h3>
			<NcCheckboxRadioSwitch
				:model-value="replaceExisting"
				type="switch"
				@update:model-value="replaceExisting = $event">
				Replace existing database
			</NcCheckboxRadioSwitch>
			<p class="hint sub-hint">
				Applicable for JSON restore only. When enabled, all your existing flights are deleted and replaced with the
				imported data. When disabled, imported flights are added to your existing ones and duplicates are not checked.
			</p>
			<div class="actions">
				<NcButton variant="secondary" :disabled="importingJson" @click="onJsonFilePick">
					{{ selectedJsonFile ? selectedJsonFile.name : 'Choose JSON file…' }}
				</NcButton>
				<NcButton variant="primary" :disabled="importingJson || !selectedJsonFile" @click="runJsonImport">
					Restore from JSON
				</NcButton>
			</div>
			<input
				ref="jsonFileInput"
				type="file"
				accept="application/json,.json"
				class="hidden-file-input"
				@change="onJsonFileChange">
			<p class="hint legacy-hint">
				Bulk add from legacy markdown table (copy and paste)
			</p>
			<div class="actions">
				<NcButton variant="secondary" @click="markdownDialogOpen = true">
					Import from markdown…
				</NcButton>
			</div>
			<NcNoteCard v-if="lastJsonResult" type="success" class="result">
				<p>
					<template v-if="lastJsonResult.deleted">
						Deleted <strong>{{ lastJsonResult.deleted }}</strong> existing flight{{ lastJsonResult.deleted === 1 ? '' : 's' }}.
					</template>
					Imported <strong>{{ lastJsonResult.imported }}</strong> flight{{ lastJsonResult.imported === 1 ? '' : 's' }}.
					Skipped <strong>{{ lastJsonResult.skipped.length }}</strong>.
				</p>
				<details v-if="lastJsonResult.skipped.length">
					<summary>Skipped entries</summary>
					<ul>
						<li v-for="row in lastJsonResult.skipped" :key="row.line">
							Entry {{ row.line }}: {{ row.reason }}
							<code>{{ row.raw }}</code>
						</li>
					</ul>
				</details>
			</NcNoteCard>
			<NcNoteCard v-if="lastResult" type="success" class="result">
				<p>
					Imported <strong>{{ lastResult.imported }}</strong> flight{{ lastResult.imported === 1 ? '' : 's' }} from markdown.
					Skipped <strong>{{ lastResult.skipped.length }}</strong>.
				</p>
				<details v-if="lastResult.skipped.length">
					<summary>Skipped rows</summary>
					<ul>
						<li v-for="row in lastResult.skipped" :key="row.line">
							Line {{ row.line }}: {{ row.reason }}
							<code>{{ row.raw }}</code>
						</li>
					</ul>
				</details>
			</NcNoteCard>

			<h3 class="section-heading">
				Export
			</h3>
			<p class="hint">
				Download your flights to a file.
			</p>
			<div class="actions">
				<NcButton variant="secondary" :disabled="exportingJson" @click="runJsonExport">
					Download JSON
				</NcButton>
				<NcButton variant="secondary" :disabled="exporting" @click="runExport">
					Download markdown
				</NcButton>
			</div>
		</NcSettingsSection>

		<NcSettingsSection
			name="Maintenance"
			description="Keep your flight data enriched by using reference data. Reference data is managed by an admin under Administration settings.">
			<h3>Reconcile airports</h3>
			<p class="hint">
				Match the origin and destination label of your flights against the Airports
				reference data, filling in airport details where an exact match is found.
				This enables to calculate distances and show flights on the map.
			</p>
			<NcCheckboxRadioSwitch
				:model-value="reconcileAllFlights"
				type="switch"
				@update:model-value="reconcileAllFlights = $event">
				Re-check all flights (otherwise only flights with no match yet)
			</NcCheckboxRadioSwitch>
			<div class="actions">
				<NcButton variant="secondary" :disabled="reconciling" @click="runReconcile">
					Reconcile airports
				</NcButton>
			</div>
		</NcSettingsSection>

		<NcSettingsSection
			name="Delete"
			description="Permanently remove flight data from your journal.">
			<NcNoteCard type="warning" class="instructions">
				<p>This will delete all flights from your database.</p>
			</NcNoteCard>
			<div class="actions">
				<NcButton variant="error" :disabled="deleting" @click="runDeleteAll">
					Delete all flights
				</NcButton>
			</div>
		</NcSettingsSection>

		<NcDialog
			:open="markdownDialogOpen"
			name="Import from markdown"
			size="large"
			@update:open="markdownDialogOpen = $event">
			<div class="md-dialog">
				<NcNoteCard type="info" class="instructions">
					<p>Paste a markdown table with the columns <code>Date | Flight | Route | Type | Tail</code>.</p>
					<p>Date may be <code>YYYY/MM/DD</code> or <code>YYYY-MM-DD</code>.</p>
					<p>Route is <code>ORIGIN-DESTINATION</code>.</p>
					<p>Header and separator rows are optional. Markdown import always appends.</p>
				</NcNoteCard>
				<NcTextArea
					v-model="importContent"
					label="Markdown content"
					:rows="10"
					placeholder="| Date | Flight | Route | Type | Tail |
|------|--------|-------|------|------|
| 2026/04/26 | BA117 | LHR-JFK | B777-300ER | G-STBM |" />
			</div>
			<template #actions>
				<NcButton variant="primary" :disabled="importing" @click="runImport">
					Import
				</NcButton>
			</template>
		</NcDialog>
	</div>
</template>

<style scoped>
h3 {
	font-size: 16px;
	font-weight: bold;
	margin-bottom: 8px;
}

.hint {
	color: var(--color-text-maxcontrast);
	margin-bottom: 8px;
}

.sub-hint {
	margin-top: 4px;
	margin-left: 28px;
	font-size: 0.9em;
}

.legacy-hint {
	margin-top: 20px;
	margin-bottom: 0;
	font-size: 0.9em;
}

.md-dialog {
	padding: 8px 4px;
}

.instructions {
	margin-bottom: 12px;
}

.instructions p {
	margin: 0;
}

.instructions p + p {
	margin-top: 4px;
}

.actions {
	display: flex;
	gap: 8px;
	margin-top: 12px;
}

.result {
	margin-top: 16px;
}

.result code {
	display: block;
	margin-top: 4px;
	font-size: 0.85em;
	color: var(--color-text-maxcontrast);
	word-break: break-all;
}

.section-heading {
	margin-top: 24px;
}

.hidden-file-input {
	display: none;
}
</style>
