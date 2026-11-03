import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router.ts'
import { trackKeyboardInset } from './keyboardInset.ts'
import './styles/views.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#flightjournal')
trackKeyboardInset()
