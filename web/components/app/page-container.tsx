import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

// The standard centered page column (max-w-7xl + edge padding). The shells'
// <main> is full-bleed so the review surface can use the whole viewport
// (DESIGN.md: the docs grid must not reserve space for chrome that isn't
// there); every other page opts back into the centered column with this.
export function PageContainer({
  children,
  flush = false,
}: {
  children: ReactNode;
  // Skip the vertical padding — for banners that stack above a full-bleed
  // surface and own their spacing.
  flush?: boolean;
}) {
  return (
    <div className={cn('mx-auto w-full max-w-7xl px-6', flush ? null : 'py-10 sm:py-14')}>
      {children}
    </div>
  );
}
