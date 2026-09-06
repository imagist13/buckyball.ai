'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTranslation } from '@/hooks/useTranslation';
import type { GalleryItem } from './GalleryGrid';
import { GalleryTagEditor } from './GalleryTagEditor';

interface GalleryTagDialogProps {
  item: GalleryItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateTags: (
    id: string,
    tags: readonly string[],
  ) => Promise<boolean>;
}

export function GalleryTagDialog({
  item,
  open,
  onOpenChange,
  onUpdateTags,
}: GalleryTagDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('gallery.manageTags')}</DialogTitle>
          <DialogDescription>
            {t('gallery.tagsDescription')}
          </DialogDescription>
        </DialogHeader>
        {item && (
          <GalleryTagEditor
            tags={item.tags}
            onChange={(tags) => onUpdateTags(item.id, tags)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
