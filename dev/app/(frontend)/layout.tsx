import type { ReactNode } from 'react'

export const metadata = {
  title: 'Live Preview Inspector Demo',
}

const Layout = ({ children }: { children: ReactNode }) => (
  <html lang="en">
    <body>{children}</body>
  </html>
)

export default Layout
