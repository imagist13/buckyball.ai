'use client';

import type { ExternalSource } from '@/types';
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from '@/components/ai-elements/sources';
import { useTranslation } from '@/hooks/useTranslation';

export function SearchSources({ sources }: { sources: readonly ExternalSource[] }) {
  const { t } = useTranslation();
  const unique = Array.from(
    new Map(
      sources
        .filter(source => source.trust === 'external' && /^https?:\/\//i.test(source.url))
        .map(source => [source.url, source] as const),
    ).values(),
  );
  if (unique.length === 0) return null;

  return (
    <Sources className="mt-2">
      <SourcesTrigger count={unique.length}>
        <span className="inline-flex items-center gap-1.5 font-medium">
          {t('sources.used', { count: String(unique.length) })}
        </span>
      </SourcesTrigger>
      <SourcesContent>
        {unique.map(source => {
          let fallback = source.url;
          try {
            fallback = new URL(source.url).hostname;
          } catch {
            // Defensive fallback for malformed legacy data.
          }
          return (
            <Source
              key={source.url}
              href={source.url}
              title={source.title || fallback}
            />
          );
        })}
      </SourcesContent>
    </Sources>
  );
}
