'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { CodePilotIcon } from '@/components/ui/semantic-icon';
import { cn, parseDBDate } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import type { GalleryItem } from './GalleryGrid';
import { GalleryTagEditor } from './GalleryTagEditor';

interface GalleryDetailProps {
  item: GalleryItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete?: (id: string) => Promise<AssetMutationResult>;
  onToggleFavorite?: (id: string) => void;
  onUpdateTags?: (
    id: string,
    tags: readonly string[],
  ) => Promise<boolean>;
}

export interface AssetMutationResult {
  ok: boolean;
  error?: string;
  code?: string;
  consumers?: Array<{ label: string }>;
}

interface AssetDetailPayload {
  lineage?: {
    parents?: Array<{
      parent_asset_id: string;
      relation: string;
    }>;
    children?: Array<{
      child_asset_id: string;
      relation: string;
    }>;
  };
  consumers?: Array<{ label: string }>;
}

function imageUrl(img: GalleryItem['images'][0]): string {
  if (img.localPath) {
    return `/api/media/serve?path=${encodeURIComponent(img.localPath)}`;
  }
  if (img.data) {
    return `data:${img.mimeType};base64,${img.data}`;
  }
  return '';
}

function formatDate(dateStr: string): string {
  try {
    const date = parseDBDate(dateStr);
    return date.toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

export function GalleryDetail({
  item,
  open,
  onOpenChange,
  onDelete,
  onToggleFavorite,
  onUpdateTags,
}: GalleryDetailProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [mutating, setMutating] = useState(false);
  const [assetDetail, setAssetDetail] = useState<AssetDetailPayload | null>(null);

  // Reset state when item changes (React-recommended ref pattern instead of useEffect+setState)
  const prevItemId = useRef(item?.id);
  if (item?.id !== prevItemId.current) {
    prevItemId.current = item?.id;
    setCurrentImageIndex(0);
    setConfirmDelete(false);
    setDeleteError('');
    setAssetDetail(null);
  }

  useEffect(() => {
    if (!open || !item) return;
    let cancelled = false;
    fetch(`/api/assets/${encodeURIComponent(item.id)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!cancelled && payload) setAssetDetail(payload);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [item, open]);

  const handleDownload = useCallback(async () => {
    if (!item) return;
    const img = item.images[currentImageIndex];
    if (!img) return;

    const url = imageUrl(img);
    const ext = img.mimeType.split('/')[1] || 'png';
    const filename = `generated-${item.id}-${currentImageIndex + 1}.${ext}`;

    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(url, '_blank');
    }
  }, [item, currentImageIndex]);

  const handleDelete = useCallback(async () => {
    if (!item) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setMutating(true);
    setDeleteError('');
    const result = await onDelete?.(item.id);
    setMutating(false);
    if (!result?.ok) {
      const consumers = result?.consumers?.map((entry) => entry.label).join(', ');
      setDeleteError(
        consumers
          ? t('gallery.deleteBlocked', { consumers })
          : t('gallery.deleteFailed'),
      );
      return;
    }
    onOpenChange(false);
    setConfirmDelete(false);
  }, [item, confirmDelete, onDelete, onOpenChange, t]);

  if (!item) return null;

  const currentImage = item.images[currentImageIndex];
  const hasMultipleImages = item.images.length > 1;
  const isVideo = item.type === 'video' || !!currentImage?.mimeType?.startsWith('video/');
  const isAudio = item.type === 'audio' || !!currentImage?.mimeType?.startsWith('audio/');
  const isHtml = item.type === 'html_bundle';
  const integrityFailed =
    item.integrityState && item.integrityState !== 'valid';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="h-[calc(100dvh-4rem)] max-h-[calc(100dvh-4rem)] w-full max-w-[calc(100vw-4rem)] grid-rows-[minmax(0,1fr)] overflow-hidden border-0 p-0 sm:max-w-[calc(100vw-4rem)]"
        showCloseButton
      >
        <DialogTitle className="sr-only">
          {t('gallery.mediaDetail' as TranslationKey)}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {t('gallery.description' as TranslationKey)}
        </DialogDescription>

        <div className="flex h-full min-h-0 flex-row overflow-hidden">
          {/* Left: Media preview */}
          <div className="relative min-h-0 w-[70%] shrink-0 bg-black">
            <div className="absolute inset-0 flex items-center justify-center">
              {integrityFailed ? (
                <div className="flex max-w-md flex-col items-center gap-3 px-6 text-center text-white/80">
                  <CodePilotIcon name="warning" size="xl" aria-hidden />
                  <p className="text-sm">
                    {t(
                      item.integrityState === 'missing'
                        ? 'gallery.integrity.missing'
                        : 'gallery.integrity.modified',
                    )}
                  </p>
                  {item.integrityReason && (
                    <p className="text-xs text-white/50">{item.integrityReason}</p>
                  )}
                </div>
              ) : isHtml ? (
                item.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.thumbnailUrl}
                    alt={item.title?.trim() || item.prompt}
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <CodePilotIcon
                    name="web"
                    size="xl"
                    className="text-white/40"
                    aria-hidden
                  />
                )
              ) : currentImage && (
                isVideo ? (
                   
                  <video
                    src={imageUrl(currentImage)}
                    controls
                    preload="metadata"
                    className="max-w-full max-h-full object-contain"
                  />
                ) : isAudio ? (
                  <div className="flex w-full max-w-xl flex-col items-center gap-5 px-8">
                    <CodePilotIcon name="media_audio" size="xl" className="text-white/70" aria-hidden />
                    <audio
                      src={imageUrl(currentImage)}
                      controls
                      preload="metadata"
                      className="w-full"
                    />
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageUrl(currentImage)}
                    alt={item.prompt}
                    className="max-w-full max-h-full object-contain"
                  />
                )
              )}
            </div>

            {hasMultipleImages && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCurrentImageIndex((i) => (i > 0 ? i - 1 : item.images.length - 1))}
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70 z-10"
                >
                  <CodePilotIcon name="back" size="lg" aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCurrentImageIndex((i) => (i < item.images.length - 1 ? i + 1 : 0))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70 z-10"
                >
                  <CodePilotIcon name="forward" size="lg" aria-hidden />
                </Button>
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-2 py-0.5 text-xs text-white z-10">
                  {currentImageIndex + 1} / {item.images.length}
                </div>
              </>
            )}
          </div>

          {/* Right: Info panel */}
          <div className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto overscroll-contain border-l border-border/50 p-6 [scrollbar-gutter:stable]">
            {/* Favorite button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onToggleFavorite?.(item.id)}
              className="gap-1.5 text-foreground"
            >
              <CodePilotIcon
                name="favorite"
                size="lg"
                strokeWidth={1.5}
                className={cn(
                  '[&_path]:fill-current',
                  item.favorited
                    ? 'text-status-error-foreground'
                    : 'text-muted-foreground',
                )}
                aria-hidden
              />
              {item.favorited
                ? t('gallery.removeFromFavorites' as TranslationKey)
                : t('gallery.addToFavorites' as TranslationKey)}
            </Button>

            {/* Prompt */}
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">
                {t('gallery.prompt' as TranslationKey)}
              </div>
              <p className="text-sm text-foreground leading-relaxed">{item.prompt}</p>
            </div>

            {/* Metadata badges */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {item.kind && (
                <Badge variant="outline" className="text-[10px]">
                  {item.kind}
                </Badge>
              )}
              {item.model && (
                <Badge variant="secondary" className="text-[10px] gap-1">
                  <CodePilotIcon name="appearance" size={12} aria-hidden />
                  {item.model}
                </Badge>
              )}
              {item.aspectRatio && (
                <Badge variant="outline" className="text-[10px]">
                  {item.aspectRatio}
                </Badge>
              )}
              {item.imageSize && (
                <Badge variant="outline" className="text-[10px]">
                  {item.imageSize}
                </Badge>
              )}
            </div>

            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                {t('gallery.tags')}
              </div>
              <GalleryTagEditor
                tags={item.tags}
                onChange={(tags) => (
                  onUpdateTags
                    ? onUpdateTags(item.id, tags)
                    : Promise.resolve(false)
                )}
              />
            </div>

            <div className="space-y-2 text-xs">
              {item.producerId && (
                <div>
                  <span className="text-muted-foreground">{t('gallery.source')}: </span>
                  <span className="break-all">{item.producerId}</span>
                </div>
              )}
              {item.projectId && (
                <div>
                  <span className="text-muted-foreground">{t('gallery.project')}: </span>
                  <span className="break-all">{item.projectId}</span>
                </div>
              )}
              {item.runtimeId && (
                <div>
                  <span className="text-muted-foreground">{t('gallery.runtime')}: </span>
                  <span>{item.runtimeId}</span>
                </div>
              )}
              {item.methodRef && (
                <div>
                  <span className="text-muted-foreground">{t('gallery.method')}: </span>
                  <span className="break-all">{item.methodRef}</span>
                </div>
              )}
              {item.integrityState && (
                <div>
                  <span className="text-muted-foreground">{t('gallery.integrity')}: </span>
                  <span>
                    {t(`gallery.integrity.${item.integrityState}` as TranslationKey)}
                  </span>
                </div>
              )}
              {item.generationStatus && (
                <div>
                  <span className="text-muted-foreground">
                    {t('gallery.generationStatus')}:{' '}
                  </span>
                  <span>{item.generationStatus}</span>
                </div>
              )}
            </div>

            {isHtml && (
              <p className="rounded-md bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                {t('gallery.staticWebPreviewHint')}
              </p>
            )}

            {isHtml && item.externalUrls && item.externalUrls.length > 0 && (
              <div className="space-y-2">
                <div>
                  <div className="text-xs font-medium text-muted-foreground">
                    {t('gallery.externalResources')}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('gallery.externalResourcesHint')}
                  </p>
                </div>
                <ul className="space-y-1 text-[11px] text-foreground">
                  {item.externalUrls.slice(0, 10).map((url) => (
                    <li
                      key={url}
                      className="break-all rounded-md bg-muted/40 px-2 py-1.5"
                    >
                      {url}
                    </li>
                  ))}
                </ul>
                {item.externalUrls.length > 10 && (
                  <p className="text-[11px] text-muted-foreground">
                    {t('gallery.externalResourcesMore', {
                      count: item.externalUrls.length - 10,
                    })}
                  </p>
                )}
              </div>
            )}

            {assetDetail && (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  {t('gallery.lineage')}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary" className="border-0 text-[10px]">
                    {t('gallery.parents', {
                      count: assetDetail.lineage?.parents?.length || 0,
                    })}
                  </Badge>
                  <Badge variant="secondary" className="border-0 text-[10px]">
                    {t('gallery.children', {
                      count: assetDetail.lineage?.children?.length || 0,
                    })}
                  </Badge>
                  <Badge variant="secondary" className="border-0 text-[10px]">
                    {t('gallery.consumers', {
                      count: assetDetail.consumers?.length || 0,
                    })}
                  </Badge>
                </div>
                {(assetDetail.lineage?.parents?.length || 0) > 0 && (
                  <div className="mt-2 space-y-1 text-[10px] text-muted-foreground">
                    {assetDetail.lineage?.parents?.map((parent) => (
                      <div key={`${parent.parent_asset_id}:${parent.relation}`}>
                        ← {parent.relation} · {parent.parent_asset_id.slice(0, 12)}
                      </div>
                    ))}
                  </div>
                )}
                {(assetDetail.lineage?.children?.length || 0) > 0 && (
                  <div className="mt-2 space-y-1 text-[10px] text-muted-foreground">
                    {assetDetail.lineage?.children?.map((child) => (
                      <div key={`${child.child_asset_id}:${child.relation}`}>
                        → {child.relation} · {child.child_asset_id.slice(0, 12)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Reference images */}
            {item.referenceImages && item.referenceImages.length > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1.5">
                  {t('imageGen.referenceImages' as TranslationKey)}
                </div>
                <div className="flex gap-2 flex-wrap">
                  {item.referenceImages.map((ref, i) => {
                    const src = ref.localPath
                      ? `/api/media/serve?path=${encodeURIComponent(ref.localPath)}`
                      : '';
                    if (!src) return null;
                    return (
                      <div key={i} className="w-14 h-14 rounded-md border border-border/30 overflow-hidden bg-muted/30">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt={`Reference ${i + 1}`} className="w-full h-full object-cover" />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Date */}
            <div className="text-xs text-muted-foreground">
              {formatDate(item.created_at)}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-3 flex-wrap">
              {item.session_id && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onOpenChange(false);
                    router.push(`/chat/${item.session_id}`);
                  }}
                >
                  <CodePilotIcon name="chat" size="sm" aria-hidden />
                  {t('gallery.openChat' as TranslationKey)}
                </Button>
              )}
              {!isHtml && !integrityFailed && (
                <Button variant="outline" size="sm" onClick={handleDownload}>
                  <CodePilotIcon name="download" size="sm" aria-hidden />
                  {t('gallery.download' as TranslationKey)}
                </Button>
              )}
              <div className="ml-auto flex items-center gap-1.5">
                {confirmDelete && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setConfirmDelete(false);
                      setDeleteError('');
                    }}
                    disabled={mutating}
                  >
                    {t('gallery.cancel')}
                  </Button>
                )}
                <Button
                  variant={confirmDelete ? 'destructive' : 'outline'}
                  size="sm"
                  onClick={handleDelete}
                  disabled={mutating}
                >
                  <CodePilotIcon name="delete" size="sm" aria-hidden />
                  {confirmDelete
                    ? t('gallery.confirmDelete')
                    : t('gallery.delete')}
                </Button>
              </div>
            </div>
            {confirmDelete && !deleteError && (
              <p className="text-xs text-destructive">
                {t('gallery.deleteConfirm')}
              </p>
            )}
            {deleteError && (
              <p className="text-xs text-destructive">{deleteError}</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
