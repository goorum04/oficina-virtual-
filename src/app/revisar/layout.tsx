import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'Para revisar · Oficina',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Oficina', statusBarStyle: 'default' },
  icons: { apple: '/icon-192.png' },
}

export const viewport: Viewport = { themeColor: '#0f172a', width: 'device-width', initialScale: 1 }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
