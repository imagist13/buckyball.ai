'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CodePilotIcon } from '@/components/ui/semantic-icon';
import { useTranslation } from '@/hooks/useTranslation';

interface GalleryTagEditorProps {
  tags: readonly string[];
  onChange: (tags: readonly string[]) => Promise<boolean>;
}

export function GalleryTagEditor({
  tags,
  onChange,
}: GalleryTagEditorProps) {
  const { t } = useTranslation();
  const [newTag, setNewTag] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const persist = async (nextTags: readonly string[]) => {
    setSaving(true);
    setError('');
    const saved = await onChange(nextTags);
    setSaving(false);
    if (!saved) setError(t('gallery.tagUpdateFailed'));
    return saved;
  };

  const addTag = async () => {
    const candidate = newTag.trim();
    if (!candidate) return;
    const duplicate = tags.some(
      (tag) => tag.localeCompare(candidate, undefined, {
        sensitivity: 'accent',
      }) === 0,
    );
    if (duplicate) {
      setNewTag('');
      return;
    }
    if (await persist([...tags, candidate])) setNewTag('');
  };

  return (
    <div className="space-y-2">
      <div className="flex min-h-6 flex-wrap items-center gap-1.5">
        {tags.length === 0 && (
          <span className="text-xs text-muted-foreground">
            {t('gallery.noTags')}
          </span>
        )}
        {tags.map((tag) => (
          <Badge
            key={tag}
            variant="secondary"
            className="gap-1 border-0 pr-1"
          >
            <CodePilotIcon name="tag" size={11} aria-hidden />
            {tag}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="ml-0.5 size-4 rounded-full p-0 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
              aria-label={`${t('gallery.removeTag')}: ${tag}`}
              disabled={saving}
              onClick={() => void persist(tags.filter((entry) => entry !== tag))}
            >
              <CodePilotIcon name="cancel" size={10} aria-hidden />
            </Button>
          </Badge>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={newTag}
          onChange={(event) => setNewTag(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void addTag();
            }
          }}
          placeholder={t('gallery.newTagPlaceholder')}
          aria-label={t('gallery.newTag')}
          className="h-8 min-w-0 text-xs"
          maxLength={32}
          disabled={saving}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 shrink-0 gap-1.5"
          disabled={saving || !newTag.trim()}
          onClick={() => void addTag()}
        >
          <CodePilotIcon name="plus" size="sm" aria-hidden />
          {t('gallery.addTag')}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
