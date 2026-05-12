<script setup lang="ts">
import { ref } from 'vue'
import axios from '@nextcloud/axios'
import { generateOcsUrl } from '@nextcloud/router'
import { showConfirmation, showError, showSuccess } from '@nextcloud/dialogs'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcSettingsSection from '@nextcloud/vue/components/NcSettingsSection'
import NcTextArea from '@nextcloud/vue/components/NcTextArea'

interface SkippedRow { line: number; reason: string; raw: string }
interface ImportResult { imported: number; skipped: SkippedRow[] }

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

const importContent = ref('')
const importing = ref(false)
const lastResult = ref<ImportResult | null>(null)
const exporting = ref(false)
const deleting = ref(false)

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
	const { imported, skipped } = result
	if (skipped.length === 0) {
		showSuccess(`Imported ${imported} flight${imported === 1 ? '' : 's'}.`)
		importContent.value = ''
	} else {
		showSuccess(`Imported ${imported}, skipped ${skipped.length}.`)
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
		a.download = 'flightjournal-export.md'
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
	<NcSettingsSection
		name="Import / Export"
		description="Import past flights from a markdown table, or download your flights as markdown.">
		<h3>Import</h3>
		<p class="hint">
			Import will append flights in your existing database. It does not check for duplicates.
		</p>
		<NcNoteCard type="info" class="instructions">
			<p>Paste a markdown table with the columns <code>Date | Flight | Route | Type | Tail</code>.</p>
			<p>Date may be <code>YYYY/MM/DD</code> or <code>YYYY-MM-DD</code>.</p>
			<p>Route is <code>ORIGIN-DESTINATION</code>.</p>
			<p>Header and separator rows are optional.</p>
		</NcNoteCard>
		<NcTextArea
			v-model="importContent"
			label="Markdown content"
			:rows="10"
			placeholder="| Date | Flight | Route | Type | Tail |
|------|--------|-------|------|------|
| 2026/04/26 | BA117 | LHR-JFK | B777-300ER | G-STBM |" />
		<div class="actions">
			<NcButton variant="secondary" :disabled="importing" @click="runImport">
				Import
			</NcButton>
		</div>
		<NcNoteCard v-if="lastResult" type="success" class="result">
			<p>
				Imported <strong>{{ lastResult.imported }}</strong> flight{{ lastResult.imported === 1 ? '' : 's' }}.
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

		<h3 class="export-heading">
			Export
		</h3>
		<p class="hint">
			Download all your flights as a markdown table you can paste back later.
		</p>
		<div class="actions">
			<NcButton variant="secondary" :disabled="exporting" @click="runExport">
				Download markdown
			</NcButton>
		</div>

		<h3 class="danger-heading">
			Delete
		</h3>
		<NcNoteCard type="warning" class="instructions">
			<p>This will delete all flights from your database.</p>
		</NcNoteCard>
		<div class="actions">
			<NcButton variant="error" :disabled="deleting" @click="runDeleteAll">
				Delete all flights
			</NcButton>
		</div>
	</NcSettingsSection>
</template>

<style scoped>
.hint {
	color: var(--color-text-maxcontrast);
	margin-bottom: 8px;
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

.export-heading {
	margin-top: 24px;
}

.danger-heading {
	margin-top: 24px;
}
</style>
