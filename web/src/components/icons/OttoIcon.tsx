import type { SVGProps } from "react";

// Otto mascot — the generic fallback glyph for sub-agents that don't match
// a known coding-agent brand (Claude/Codex/Cursor/…) or a category role
// (explore/research/plan/…). Authored here as an original brand mark so the
// icon never depends on a third-party asset: a five-armed starfish with a
// soft body curve, two simple eyes, and a small smile. `currentColor` lets
// the glyph pick up the row's muted-foreground tone like the rest of the
// rail's monochrome icons, while keeping the brand silhouette intact. The
// viewBox pads the mark's ~80×80 bounds so it sits at the same optical
// size as the lucide/lobehub icons next to it.
export function OttoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth={0.6}
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {/* Starfish body — five rounded arms radiating from a soft center.
          Drawn as a single closed path so the whole silhouette is one
          fillable shape (a clean outline would need many more paths to
          round the inner corners cleanly). */}
      <path d="M12 2.4
               C 13.2 2.4 14.1 3.2 14.4 4.4
               C 14.7 5.7 15.9 6.5 17.2 6.5
               C 18.6 6.5 19.7 7.6 19.7 9.0
               C 19.7 10.4 18.9 11.5 17.7 11.9
               C 16.6 12.2 15.9 13.3 15.9 14.4
               C 15.9 15.9 14.7 17.1 13.2 17.1
               C 12.0 17.1 11.0 16.4 10.6 15.3
               C 10.3 14.2 9.2 13.5 8.1 13.5
               C 6.7 13.5 5.6 12.4 5.6 11.0
               C 5.6 9.7 6.4 8.6 7.5 8.2
               C 8.7 7.8 9.4 6.7 9.4 5.5
               C 9.4 3.9 10.6 2.4 12.0 2.4 Z
               M 12 2.9
               C 11.2 2.9 10.5 4.0 10.5 5.3
               C 10.5 7.0 9.4 8.5 7.7 8.9
               C 6.7 9.2 6.2 9.9 6.2 10.9
               C 6.2 12.0 6.9 12.7 8.0 12.7
               C 9.6 12.7 11.1 13.8 11.5 15.4
               C 11.8 16.3 12.5 16.7 13.3 16.7
               C 14.4 16.7 15.1 15.9 15.1 14.6
               C 15.1 13.0 16.2 11.5 17.9 11.1
               C 19.0 10.8 19.6 10.0 19.6 9.0
               C 19.6 7.9 18.8 7.2 17.4 7.2
               C 15.7 7.2 14.2 6.1 13.8 4.4
               C 13.5 3.5 12.9 2.9 12.0 2.9 Z" />
      {/* Soft inner highlight — a slightly lighter disc to give the mascot
          a hint of dimensionality without breaking the monochrome theme.
          Drawn at low opacity so it only nudges tone, never fights the
          parent text color. */}
      <circle cx="12" cy="10" r="2.4" fill="currentColor" fillOpacity={0.18} stroke="none" />
      {/* Eyes — two small filled dots, kept inside the inner highlight so
          they read as the face and not stray pixels. */}
      <circle cx="10.9" cy="9.6" r="0.55" stroke="none" />
      <circle cx="13.1" cy="9.6" r="0.55" stroke="none" />
      {/* Smile — a short stroked arc below the eyes. */}
      <path
        d="M11.0 11.0 C 11.5 11.5 12.5 11.5 13.0 11.0"
        fill="none"
        stroke="currentColor"
        strokeWidth={0.7}
        strokeLinecap="round"
      />
    </svg>
  );
}
