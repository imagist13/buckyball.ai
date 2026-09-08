/**
 * Buckyball.ai app icon — the canonical brand mark.
 *
 * Used in the brand-anchor surfaces:
 *   1. Runtime selector / Runtime panel (Settings → Runtime) — the
 *      visual identity of the "Buckyball.ai Runtime" engine entry.
 *   2. New-chat welcome (centered hero above the composer) — the
 *      brand greeting.
 *   3. About page (Settings → About) — the canonical brand surface.
 *   4. Setup Center welcome card.
 *
 * Design:
 *   - Loaded from /logo/logo.png (public asset).
 *   - Shape fills route through `currentColor` for the icon stroke/lettering
 *     (via the PNG's baked-in styling) while the container naturally handles
 *     theme contrast.
 *   - 2026-09-08: replaced inline SVG with the PNG brand asset.
 */

import Image from 'next/image';
import { cn } from '@/lib/utils';

interface MonolithIconProps {
  className?: string;
  /** Optional pixel size — leave undefined to fill parent via CSS. */
  size?: number;
  style?: React.CSSProperties;
}

export function MonolithIcon({ className, size, style }: MonolithIconProps) {
  const sized: React.CSSProperties | undefined = size != null
    ? { width: size, height: size, ...style }
    : style;

  return (
    <Image
      src="/logo/logo.png"
      alt="Buckyball"
      width={size ?? 36}
      height={size ?? 36}
      className={cn('shrink-0', className)}
      style={sized}
      priority
    />
  );
}
