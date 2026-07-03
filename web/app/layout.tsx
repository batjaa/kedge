import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';

// DESIGN.md: system font stack only — no webfonts. Dark-first.
export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider theme={{ defaultTheme: 'dark' }}>{children}</RootProvider>
      </body>
    </html>
  );
}
