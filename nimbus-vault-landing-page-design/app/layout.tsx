import { Analytics } from '@vercel/analytics/next'
import { BootPreloader } from '@/components/boot-preloader'
import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'NimbusVault AI — Your files are only the beginning',
  description: 'NimbusVault is a secure home for your files today and an intelligent document workspace for tomorrow.',
  generator: 'NimbusVault AI',
  openGraph: {
    title: 'NimbusVault AI — Your files are only the beginning',
    description: 'A secure, thoughtful workspace for files, teams and the intelligence layer ahead.',
    type: 'website',
  },
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#050914',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <BootPreloader />
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
