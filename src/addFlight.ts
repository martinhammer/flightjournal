import { ref } from 'vue'

// Whether the one AddFlightDialog (rendered by App.vue) is open. Shared because
// the navigation entry and the Flight log's card-layout button both open it.
export const addFlightOpen = ref(false)
