'use client';

import {
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CodePilotIcon } from '@/components/ui/semantic-icon';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';

export interface GalleryItem {
  id: string;
  /** Generation provider (e.g. 'gemini', 'codex', 'cli-import'). Used by
   *  the UI to label the engine that produced the image. */
  provider?: string;
  prompt: string;
  title?: string;
  images: Array<{ data?: string; mimeType: string; localPath?: string }>;
  type?: 'image' | 'video' | 'audio' | 'html_bundle';
  kind?: 'image' | 'video' | 'audio' | 'html_bundle';
  previewUrl?: string;
  thumbnailUrl?: string;
  producerId?: string;
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  tags: string[];
  favorited?: boolean;
  created_at: string;
  session_id?: string;
  projectId?: string;
  runtimeId?: string;
  methodRef?: string;
  contentHash?: string;
  integrityState?: 'valid' | 'missing' | 'modified';
  integrityReason?: string;
  trustTier?: string;
  externalUrls?: string[];
  generationStatus?: string;
  legacyOnly?: boolean;
  referenceImages?: Array<{ mimeType: string; localPath: string }>;
}

interface GalleryGridProps {
  items: GalleryItem[];
  onSelect: (item: GalleryItem) => void;
  onManageTags: (item: GalleryItem) => void;
  onToggleFavorite: (item: GalleryItem) => void;
  onRequestDelete: (item: GalleryItem) => void;
}

interface MasonryPosition {
  left: number;
  top: number;
  width: number;
}

const COLUMN_GAP = 12;
const MIN_COLUMN_WIDTH = 240;

function thumbnailUrl(item: GalleryItem): string {
  const media = item.images[0];
  if (!media) return '';
  if (media.localPath) {
    return `/api/media/serve?path=${encodeURIComponent(media.localPath)}`;
  }
  if (media.data) {
    return `data:${media.mimeType};base64,${media.data}`;
  }
  return '';
}

function isVideoItem(item: GalleryItem): boolean {
  if (item.type === 'video') return true;
  const media = item.images[0];
  return !!media?.mimeType?.startsWith('video/');
}

function isAudioItem(item: GalleryItem): boolean {
  if (item.type === 'audio') return true;
  const media = item.images[0];
  return !!media?.mimeType?.startsWith('audio/');
}

function estimatedCardHeight(item: GalleryItem, width: number): number {
  if (item.type === 'html_bundle') return width * 9 / 16;
  if (isAudioItem(item)) return width * 3 / 4;
  const ratio = item.aspectRatio?.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (ratio) {
    const ratioWidth = Number(ratio[1]);
    const ratioHeight = Number(ratio[2]);
    if (ratioWidth > 0 && ratioHeight > 0) {
      return width * ratioHeight / ratioWidth;
    }
  }
  return width;
}

function MasonryItem({
  id,
  position,
  onHeight,
  children,
}: {
  id: string;
  position: MasonryPosition;
  onHeight: (id: string, height: number) => void;
  children: ReactNode;
}) {
  const measureRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = measureRef.current;
    if (!node) return;
    const measure = () => onHeight(id, node.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [id, onHeight]);

  return (
    <div
      className="absolute"
      style={{
        left: position.left,
        top: position.top,
        width: position.width,
      }}
    >
      <div ref={measureRef}>{children}</div>
    </div>
  );
}

export function GalleryGrid({
  items,
  onSelect,
  onManageTags,
  onToggleFavorite,
  onRequestDelete,
}: GalleryGridProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({});

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const measure = () => setContainerWidth(node.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const handleHeight = useCallback((id: string, height: number) => {
    setMeasuredHeights((current) => (
      Math.abs((current[id] || 0) - height) < 0.5
        ? current
        : { ...current, [id]: height }
    ));
  }, []);

  const layout = useMemo(() => {
    if (containerWidth <= 0) {
      return {
        positions: new Map<string, MasonryPosition>(),
        height: 0,
      };
    }
    const columnCount = Math.max(
      1,
      Math.floor((containerWidth + COLUMN_GAP) / (MIN_COLUMN_WIDTH + COLUMN_GAP)),
    );
    const columnWidth = (
      containerWidth - COLUMN_GAP * (columnCount - 1)
    ) / columnCount;
    const columnHeights = Array.from({ length: columnCount }, () => 0);
    const positions = new Map<string, MasonryPosition>();

    for (const item of items) {
      let targetColumn = 0;
      for (let index = 1; index < columnHeights.length; index += 1) {
        if (columnHeights[index] < columnHeights[targetColumn]) {
          targetColumn = index;
        }
      }
      const top = columnHeights[targetColumn];
      positions.set(item.id, {
        left: targetColumn * (columnWidth + COLUMN_GAP),
        top,
        width: columnWidth,
      });
      columnHeights[targetColumn] = top
        + (measuredHeights[item.id] || estimatedCardHeight(item, columnWidth))
        + COLUMN_GAP;
    }

    return {
      positions,
      height: Math.max(0, ...columnHeights) - COLUMN_GAP,
    };
  }, [containerWidth, items, measuredHeights]);

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      style={{ height: layout.height }}
    >
      {items.map((item) => {
        const position = layout.positions.get(item.id);
        if (!position) return null;
        const url = thumbnailUrl(item);
        const isVideo = isVideoItem(item);
        const isAudio = isAudioItem(item);
        const isHtml = item.type === 'html_bundle';
        const displayTitle =
          isHtml && item.title?.trim() ? item.title.trim() : item.prompt;
        const integrityFailed =
          item.integrityState && item.integrityState !== 'valid';
        const promptPreview = displayTitle.length > 80
          ? `${displayTitle.slice(0, 80)}…`
          : displayTitle;
        const ariaKey: TranslationKey = isVideo
          ? 'gallery.playVideoAria'
          : isAudio
            ? 'gallery.playAudioAria'
            : 'gallery.openItemAria';

        return (
          <MasonryItem
            key={item.id}
            id={item.id}
            position={position}
            onHeight={handleHeight}
          >
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={t(ariaKey, { prompt: promptPreview })}
                  className="w-full cursor-pointer overflow-hidden rounded-lg bg-card ring-0 ring-border hover:ring-[3px] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
                  onClick={() => onSelect(item)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect(item);
                    }
                  }}
                >
                  <div className="relative bg-muted/30">
                {integrityFailed ? (
                  <div
                    className="flex min-h-36 flex-col items-center justify-center gap-2 px-4 text-center"
                    title={item.integrityReason}
                  >
                    <CodePilotIcon name="warning" size="lg" className="text-status-warning-foreground" aria-hidden />
                    <span className="text-xs text-muted-foreground">
                      {t(
                        item.integrityState === 'missing'
                          ? 'gallery.integrity.missing'
                          : 'gallery.integrity.modified',
                      )}
                    </span>
                  </div>
                ) : isHtml ? (
                  <div className="relative aspect-video w-full overflow-hidden bg-background">
                    {item.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.thumbnailUrl}
                        alt={displayTitle}
                        className="block h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-muted/30">
                        <CodePilotIcon name="web" size="xl" className="text-muted-foreground/40" aria-hidden />
                      </div>
                    )}
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-3 pb-2 pt-8 text-xs font-medium text-white">
                      <span className="block truncate">{displayTitle}</span>
                    </span>
                  </div>
                ) : isAudio && url ? (
                  <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 bg-muted/40">
                    <CodePilotIcon name="media_audio" size="xl" className="text-muted-foreground" aria-hidden />
                    <span className="px-3 text-center text-xs text-muted-foreground">
                      {t('gallery.audioPreview')}
                    </span>
                  </div>
                ) : url ? (
                  isVideo ? (
                    <video
                      src={url}
                      muted
                      preload="metadata"
                      className="block h-auto w-full"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt={item.prompt}
                      className="block h-auto w-full"
                      loading="lazy"
                    />
                  )
                ) : (
                  <div className="flex aspect-square items-center justify-center">
                    <CodePilotIcon name="appearance" size="xl" className="text-muted-foreground/30" aria-hidden />
                  </div>
                )}
                {isVideo && url && (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
                      <CodePilotIcon name="play" size="lg" strokeWidth={2} className="ml-0.5 text-white" aria-hidden />
                    </span>
                  </span>
                )}
                {isAudio && url && (
                  <span className="absolute inset-x-2 bottom-2 rounded-full bg-black/55 px-2 py-1 text-center text-[10px] text-white backdrop-blur-sm">
                    {t('gallery.audioPreview')}
                  </span>
                )}
                {item.images.length > 1 && (
                  <span className="absolute right-1.5 top-1.5 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {item.images.length}
                  </span>
                )}
                    {item.favorited && (
                      <span className="absolute left-2.5 top-2.5">
                        <CodePilotIcon
                          name="favorite"
                          size="lg"
                          strokeWidth={1.5}
                          className="text-status-error-foreground drop-shadow-md [&_path]:fill-current"
                          aria-hidden
                        />
                      </span>
                    )}
                  </div>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="min-w-40">
                <ContextMenuItem onSelect={() => onManageTags(item)}>
                  <CodePilotIcon name="tag" size="sm" aria-hidden />
                  {t('gallery.addTag')}
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => onToggleFavorite(item)}>
                  <CodePilotIcon
                    name="favorite"
                    size="sm"
                    className="[&_path]:fill-current"
                    aria-hidden
                  />
                  {item.favorited
                    ? t('gallery.removeFromFavorites')
                    : t('gallery.addToFavorites')}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  variant="destructive"
                  onSelect={() => onRequestDelete(item)}
                >
                  <CodePilotIcon name="delete" size="sm" aria-hidden />
                  {t('gallery.delete')}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </MasonryItem>
        );
      })}
    </div>
  );
}
