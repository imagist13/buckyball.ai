"use client";

import { IconContext } from "@phosphor-icons/react";
import type { ReactNode } from "react";

/**
 * Phosphor's IconContext only takes ONE default weight â€?there's no
 * size-conditional rule. Bold globally makes 14â€?6px nav/list icons
 * pleasantly thicker (matches Luma feel) but blurs â‰?2px caret/spinner
 * icons due to stroke-width vs. canvas ratio at small sizes.
 *
 * Compromise: leave the global default at "regular" so small auxiliary
 * icons stay crisp. The main visual surfaces (left nav, sidebar list rows)
 * pass explicit `weight="bold"` to keep the bolder presence the user wants.
 */
export function IconProvider({ children }: { children: ReactNode }) {
  return (
    <IconContext.Provider value={{ weight: "regular" }}>
      {children}
    </IconContext.Provider>
  );
}
