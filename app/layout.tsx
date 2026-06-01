import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Insurance Branch Queue',
  description: 'Queue management system for insurance branch walk-in customers',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  )
}
