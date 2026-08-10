import { formatDistanceToNow } from 'date-fns';
import { CheckCircle2, RotateCcw } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { SYNC_MODULES } from '@/features/sync/config/sync-tables';
import { useSyncConflicts } from '@/features/sync/hooks/use-sync-conflicts';
import type { SyncConflict } from '@/features/sync/services/conflict-repository';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/dialog-store';

/**
 * What last-write-wins threw away.
 *
 * Sync has always been last-write-wins and still is — this changes nothing about
 * who wins. What it changes is that losing is no longer silent. Editing a note
 * on a phone with no signal, editing the same note on a tablet, then
 * reconnecting used to destroy the phone's version with no trace at all; the
 * only symptom was a note that no longer said what somebody remembered writing,
 * which is indistinguishable from having imagined it.
 *
 * The list is deliberately short-lived: an entry appears when an edit is
 * overwritten and goes as soon as it is answered. It is not a history.
 */
export default function SyncConflictsScreen() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const { conflicts, isLoading, restore, keepRemote, dismissAll } = useSyncConflicts();

  const confirmDismissAll = () =>
    void confirm({
      title: t('sync.conflictDismissAllTitle'),
      message: t('sync.conflictDismissAllBody'),
      confirmLabel: t('sync.conflictKeepTheirs'),
      cancelLabel: t('common.cancel'),
    }).then((ok) => {
      if (ok) dismissAll();
    });

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('sync.conflictsTitle')}
        eyebrow={t('settings.syncAccount')}
        tint={c.accent}
      />

      {!isLoading && conflicts.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={t('sync.conflictsEmptyTitle')}
          description={t('sync.conflictsEmptyBody')}
        />
      ) : (
        <ScrollView
          contentContainerClassName="gap-4 px-5 pt-3 pb-10"
          showsVerticalScrollIndicator={false}
        >
          <Text variant="muted">{t('sync.conflictsIntro')}</Text>

          {conflicts.map((conflict) => (
            <ConflictCard
              key={conflict.id}
              conflict={conflict}
              onRestore={() => restore(conflict)}
              onKeep={() => keepRemote(conflict.id)}
            />
          ))}

          {conflicts.length > 1 ? (
            <Button
              variant="ghost"
              size="lg"
              label={t('sync.conflictDismissAll')}
              onPress={confirmDismissAll}
            />
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function ConflictCard({
  conflict,
  onRestore,
  onKeep,
}: {
  conflict: SyncConflict;
  onRestore: () => void;
  onKeep: () => void;
}) {
  const { t } = useTranslation();
  const { c } = useTheme();

  const module = SYNC_MODULES.find((m) => m.key === conflict.module);
  const moduleLabel = module ? t(module.labelKey) : conflict.module;

  return (
    <View className={cardClass({ elevation: 'e1' }, 'gap-3')}>
      <View className="gap-1">
        <Text variant="micro">{moduleLabel}</Text>
        <Text className="font-sora-semibold text-foreground">{describe(conflict)}</Text>
        <Text variant="caption">
          {t('sync.conflictWhen', {
            ago: formatDistanceToNow(conflict.remoteUpdatedAt, { addSuffix: true }),
          })}
        </Text>
      </View>

      {/* The two answers, at equal weight. "Keep theirs" is not a cancel — it is
          a real choice, and it is the one that needs no action, so it must not
          be styled as the dangerous one. */}
      <View className="flex-row gap-2">
        <Pressable
          accessibilityRole="button"
          onPress={onRestore}
          className="flex-1 flex-row items-center justify-center gap-2 rounded-full border py-2.5"
          style={{ borderColor: c.accent }}
        >
          <RotateCcw size={15} color={c.accent} />
          <Text className="font-sora-semibold" style={{ color: c.accent }}>
            {t('sync.conflictRestoreMine')}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onKeep}
          className="flex-1 items-center justify-center rounded-full border py-2.5"
          style={{ borderColor: c.border }}
        >
          <Text className="font-sora-medium" style={{ color: c.mutedForeground }}>
            {t('sync.conflictKeepTheirs')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * A human label for the overwritten row.
 *
 * Reads whichever of a handful of common text columns the snapshot happens to
 * carry, rather than a per-table mapping of forty tables onto their title
 * columns — which would be forty chances to forget one, and the failure would be
 * a conflict card with no idea what it refers to. Falls back to the table name,
 * which is at least true.
 */
function describe(conflict: SyncConflict): string {
  const snapshot = conflict.localSnapshot;
  for (const column of ['title', 'name', 'label', 'content', 'note', 'description']) {
    const value = snapshot[column];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim().slice(0, 80);
    }
  }
  return conflict.tableName;
}
