import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { setTokenProvider } from './lib/api'
import { firebaseConfigured, idToken } from './lib/firebase'
import './index.css'

if (firebaseConfigured) setTokenProvider(idToken)

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
