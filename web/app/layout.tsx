import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';

// DESIGN.md (Open Harbor): light-first, both themes always. System stacks for
// body/UI/prose; self-hosted Space Grotesk for display (see global.css). The
// default only applies with no stored choice — next-themes keeps a per-device
// pick (incl. dark) across every surface via localStorage.
export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider theme={{ defaultTheme: 'light' }}>{children}</RootProvider>
      </body>
    </html>
  );
}
