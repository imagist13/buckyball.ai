'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { SortDescending, SpinnerGap } from '@/components/ui/icon';
import {
  CodePilotIcon,
  type CodePilotIconName,
} from '@/components/ui/semantic-icon';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GalleryGrid, type GalleryItem } from '@/components/gallery/GalleryGrid';
import {
  GalleryDetail,
  type AssetMutationResult,
} from '@/components/gallery/GalleryDetail';
import { GalleryTagDialog } from '@/components/gallery/GalleryTagDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { ensureHtmlAssetThumbnail } from '@/lib/html-asset-thumbnail-client';

const PAGE_SIZE = 20;

type SortOrder = 'newest' | 'oldest';

const KIND_ICONS: Readonly<Record<string, CodePilotIconName>> = {
  image: 'image',
  video: 'media_video',
  audio: 'media_audio',
  html_bundle: 'web',
};

export default function GalleryPage() {
  const { t, locale } = useTranslation();

  const [items, setItems] = useState<GalleryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filters
  const [sort, setSort] = useState<SortOrder>('newest');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [kind, setKind] = useState('');
  const [kinds, setKinds] = useState<Array<{
    id: string;
    displayName: { en: string; zh: string };
  }>>([]);

  // Detail
  const [selectedItem, setSelectedItem] = useState<GalleryItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [tagEditorItem, setTagEditorItem] = useState<GalleryItem | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<GalleryItem | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [thumbnailSweep, setThumbnailSweep] = useState(0);
  const thumbnailAttemptsRef = useRef(new Set<string>());
  const nextOffsetRef = useRef(0);
  const requestVersionRef = useRef(0);
  const activeRequestRef = useRef<AbortController | null>(null);
  const loadingRef = useRef(false);

  const fetchItems = useCallback(async (reset = false) => {
    const requestOffset = reset ? 0 : nextOffsetRef.current;
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;
    loadingRef.current = true;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (favoritesOnly) params.set('favoritesOnly', '1');
      if (debouncedQuery) params.set('query', debouncedQuery);
      if (kind) params.set('kind', kind);
      params.set('sort', sort);
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(requestOffset));

      const res = await fetch(
        `/api/media/gallery?${params.toString()}`,
        { signal: controller.signal },
      );
      if (res.ok) {
        const data = await res.json();
        if (requestVersion !== requestVersionRef.current) return;
        const nextItems = Array.isArray(data.items)
          ? data.items as GalleryItem[]
          : [];
        if (reset) {
          setItems(nextItems);
        } else {
          setItems((current) => {
            const knownIds = new Set(current.map((item) => item.id));
            return [
              ...current,
              ...nextItems.filter((item) => !knownIds.has(item.id)),
            ];
          });
        }
        nextOffsetRef.current = requestOffset + nextItems.length;
        setTotal(
          typeof data.total === 'number' && Number.isFinite(data.total)
            ? data.total
            : 0,
        );
      }
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError') {
        console.error('[gallery] Failed to fetch Assets:', error);
      }
    } finally {
      if (requestVersion === requestVersionRef.current) {
        activeRequestRef.current = null;
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [
    debouncedQuery,
    favoritesOnly,
    kind,
    sort,
  ]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    fetch('/api/assets/kinds')
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (Array.isArray(data?.kinds)) setKinds(data.kinds);
      })
      .catch(() => {});
  }, []);

  // Initial load and reload on filter changes
  useEffect(() => {
    nextOffsetRef.current = 0;
    void fetchItems(true);
  }, [fetchItems]);

  useEffect(() => () => {
    requestVersionRef.current += 1;
    activeRequestRef.current?.abort();
  }, []);

  // Existing HTML Assets from before static thumbnails were introduced are
  // upgraded lazily, one at a time. The Electron main process serializes the
  // hidden captures as a second resource-safety boundary.
  useEffect(() => {
    if (!window.electronAPI?.asset?.captureHtmlThumbnail) return;
    const pending = items.find((item) => (
      item.type === 'html_bundle'
      && !!item.previewUrl
      && !item.thumbnailUrl
      && !thumbnailAttemptsRef.current.has(item.id)
    ));
    if (!pending) return;
    let cancelled = false;
    thumbnailAttemptsRef.current.add(pending.id);
    void (async () => {
      try {
        const thumbnailUrl = await ensureHtmlAssetThumbnail({
          assetId: pending.id,
          previewUrl: pending.previewUrl!,
        }).catch(() => null);
        if (!thumbnailUrl || cancelled) return;
        setItems((current) => current.map((entry) => (
          entry.id === pending.id ? { ...entry, thumbnailUrl } : entry
        )));
        setSelectedItem((current) => (
          current?.id === pending.id ? { ...current, thumbnailUrl } : current
        ));
      } finally {
        if (!cancelled) setThumbnailSweep((current) => current + 1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [items, thumbnailSweep]);

  const handleSelect = useCallback((item: GalleryItem) => {
    setSelectedItem(item);
    setDetailOpen(true);
  }, []);

  const handleDelete = useCallback(async (id: string): Promise<AssetMutationResult> => {
    try {
      const res = await fetch(`/api/media/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setItems((prev) => prev.filter((item) => item.id !== id));
        setTotal((prev) => prev - 1);
        return { ok: true };
      }
      return {
        ok: false,
        error: data.error,
        code: data.code,
        consumers: data.consumers,
      };
    } catch {
      return { ok: false };
    }
  }, []);

  const handleToggleFavorite = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/media/${id}/favorite`, { method: 'PUT' });
      if (res.ok) {
        const data = await res.json();
        const favorited = !!data.favorited;
        setItems((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, favorited } : item
          )
        );
        setSelectedItem((prev) =>
          prev && prev.id === id ? { ...prev, favorited } : prev
        );
      }
    } catch {
      // ignore
    }
  }, []);

  const handleUpdateTags = useCallback(async (
    id: string,
    tags: readonly string[],
  ): Promise<boolean> => {
    try {
      const response = await fetch(
        `/api/assets/${encodeURIComponent(id)}/tags`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags }),
        },
      );
      if (!response.ok) return false;
      const data = await response.json() as { tags?: unknown };
      if (
        !Array.isArray(data.tags)
        || !data.tags.every((tag): tag is string => typeof tag === 'string')
      ) {
        return false;
      }
      const savedTags = data.tags;
      setItems((current) => current.map((item) => (
        item.id === id ? { ...item, tags: savedTags } : item
      )));
      setSelectedItem((current) => (
        current?.id === id ? { ...current, tags: savedTags } : current
      ));
      setTagEditorItem((current) => (
        current?.id === id ? { ...current, tags: savedTags } : current
      ));
      return true;
    } catch {
      return false;
    }
  }, []);

  const handleContextDelete = useCallback(async () => {
    if (!deleteCandidate) return;
    setDeleting(true);
    setDeleteError('');
    const result = await handleDelete(deleteCandidate.id);
    setDeleting(false);
    if (result.ok) {
      setDeleteCandidate(null);
      return;
    }
    const consumers = result.consumers?.map((entry) => entry.label).join(', ');
    setDeleteError(
      consumers
        ? t('gallery.deleteBlocked', { consumers })
        : t('gallery.deleteFailed'),
    );
  }, [deleteCandidate, handleDelete, t]);

  const hasMore = items.length < total;
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingRef.current) {
          void fetchItems(false);
        }
      },
      { rootMargin: '200px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, fetchItems]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Search is the primary control; kind filters stay expanded directly
          below it so the toolbar reads top-to-bottom by information priority. */}
      <header className="shrink-0 px-6 pt-4 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('gallery.searchPlaceholder')}
            className="h-8 min-w-52 max-w-sm flex-1 text-xs"
          />
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Button
              variant={favoritesOnly ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => setFavoritesOnly((v) => !v)}
            >
              <CodePilotIcon
                name="favorite"
                size="sm"
                strokeWidth={1.5}
                className={cn(
                  '[&_path]:fill-current',
                  favoritesOnly && 'text-status-error-foreground',
                )}
                aria-hidden
              />
              {t('gallery.favoritesOnly' as TranslationKey)}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => setSort((s) => (s === 'newest' ? 'oldest' : 'newest'))}
            >
              <SortDescending size={14} />
              {sort === 'newest'
                ? t('gallery.newestFirst' as TranslationKey)
                : t('gallery.oldestFirst' as TranslationKey)}
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Button
            variant={kind === '' ? 'secondary' : 'outline'}
            size="xs"
            className="gap-1.5 rounded-full px-3"
            onClick={() => setKind('')}
          >
            <CodePilotIcon name="artifact" size={12} aria-hidden />
            {t('gallery.kindAll')}
          </Button>
          {kinds.map((entry) => (
            <Button
              key={entry.id}
              variant={kind === entry.id ? 'secondary' : 'outline'}
              size="xs"
              className="gap-1.5 rounded-full px-3"
              onClick={() => setKind(entry.id)}
            >
              <CodePilotIcon
                name={KIND_ICONS[entry.id] || 'artifact'}
                size={12}
                aria-hidden
              />
              {entry.displayName[locale]}
            </Button>
          ))}
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-5">
        {/* Gallery content */}
        {loading && items.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <CodePilotIcon name="appearance" size={40} className="opacity-30" aria-hidden />
            <p className="text-sm">{t('gallery.empty' as TranslationKey)}</p>
            <p className="text-xs opacity-70">{t('gallery.emptyHint' as TranslationKey)}</p>
          </div>
        ) : (
          <div>
            <GalleryGrid
              items={items}
              onSelect={handleSelect}
              onManageTags={setTagEditorItem}
              onToggleFavorite={(item) => void handleToggleFavorite(item.id)}
              onRequestDelete={(item) => {
                setDeleteError('');
                setDeleteCandidate(item);
              }}
            />
            {/* Sentinel for infinite scroll */}
            <div ref={sentinelRef} className="flex justify-center py-4">
              {loading && (
                <SpinnerGap size={16} className="animate-spin text-muted-foreground" />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Detail dialog */}
      <GalleryDetail
        item={selectedItem}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onDelete={handleDelete}
        onToggleFavorite={handleToggleFavorite}
        onUpdateTags={handleUpdateTags}
      />
      <GalleryTagDialog
        item={tagEditorItem}
        open={!!tagEditorItem}
        onOpenChange={(open) => {
          if (!open) setTagEditorItem(null);
        }}
        onUpdateTags={handleUpdateTags}
      />
      <AlertDialog
        open={!!deleteCandidate}
        onOpenChange={(open) => {
          if (!open && !deleting) {
            setDeleteCandidate(null);
            setDeleteError('');
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('gallery.confirmDelete')}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteError || t('gallery.deleteConfirm')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {t('gallery.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void handleContextDelete();
              }}
            >
              {t('gallery.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
