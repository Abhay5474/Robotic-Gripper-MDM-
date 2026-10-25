import { lazy, Suspense, useEffect } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import Layout from '@/components/Layout'
import { Spinner } from '@/components/ui'
import { useApp } from '@/store/app'
import { useThemeBootstrap } from '@/store/theme'
import Overview from '@/pages/Overview'
import Control from '@/pages/Control'
import Objects from '@/pages/Objects'
import Calibration from '@/pages/Calibration'
import HistoryPage from '@/pages/History'
import SettingsPage from '@/pages/Settings'
const Telemetry = lazy(() => import('@/pages/Telemetry'))

const router = createBrowserRouter([
  {
    path: '/', element: <Layout />,
    children: [
      { index: true, element: <Overview /> },
      { path: 'control', element: <Control /> },
      { path: 'objects', element: <Objects /> },
      { path: 'calibration', element: <Calibration /> },
      { path: 'telemetry', element: <Suspense fallback={<Spinner />}><Telemetry /></Suspense> },
      { path: 'history', element: <HistoryPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
])

export default function App() {
  const init = useApp((s) => s.init)
  useThemeBootstrap()
  useEffect(() => { void init() }, [init])
  return <RouterProvider router={router} />
}
