<script setup lang="ts">
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
</script>

<template>
	<div class="analytics-view">
		<div class="header">
			<h2>Analytics</h2>
		</div>
		<NcEmptyContent name="Analytics" description="Analytics will appear here in a future milestone." />
	</div>
</template>

<style scoped>
.analytics-view {
	padding: 16px;
}

.header {
	margin-bottom: 16px;
}
</style>
