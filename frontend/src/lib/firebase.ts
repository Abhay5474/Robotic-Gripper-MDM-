// Read-only Firebase Web SDK usage: live telemetry listener + optional sign-in. Writes go through the backend.
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, type Auth, type User } from 'firebase/auth'
import { getDatabase, onValue, ref, type Database } from 'firebase/database'

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}
export const firebaseConfigured = Boolean(cfg.databaseURL && cfg.apiKey && cfg.projectId)

let app: FirebaseApp | null = null
function getApp(): FirebaseApp | null {
  if (!firebaseConfigured) return null
  app ??= getApps()[0] ?? initializeApp(cfg)
  return app
}
export const getAuthSafe = (): Auth | null => { const a = getApp(); return a ? getAuth(a) : null }
const getDb = (): Database | null => { const a = getApp(); return a ? getDatabase(a) : null }

export type ConnState = 'unconfigured' | 'connecting' | 'connected' | 'disconnected' | 'error'

/** Subscribes to the telemetry node and the RTDB connection state. Returns an unsubscribe function. */
export function subscribeTelemetry(path: string, onData: (raw: unknown) => void, onConn: (s: ConnState, detail?: string) => void): () => void {
  const db = getDb()
  if (!db) { onConn('unconfigured', 'Firebase web config (VITE_FIREBASE_*) is not set.'); return () => {} }
  onConn('connecting')
  const offConn = onValue(ref(db, '.info/connected'), (s) => onConn(s.val() ? 'connected' : 'disconnected'))
  const offData = onValue(ref(db, path), (s) => onData(s.val()), (e) => onConn('error', e.message))
  return () => { offConn(); offData() }
}

export const signIn = (email: string, pw: string) => { const a = getAuthSafe(); if (!a) throw new Error('Firebase is not configured'); return signInWithEmailAndPassword(a, email, pw) }
export const signOutUser = () => { const a = getAuthSafe(); return a ? signOut(a) : Promise.resolve() }
export const onUser = (cb: (u: User | null) => void) => { const a = getAuthSafe(); return a ? onAuthStateChanged(a, cb) : (cb(null), () => {}) }
export const idToken = async () => getAuthSafe()?.currentUser?.getIdToken() ?? null
