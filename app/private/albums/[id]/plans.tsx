import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import { useLocalSearchParams } from 'expo-router';
import { format } from 'date-fns/format';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { CalendarPlus } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { moduleTints, resolveTint } from '@/constants/design-tokens';
import { PlanSheet, type PlanSheetTarget } from '@/features/private/components/plan-sheet';
import { QueryError } from '@/components/ui/query-error';
import { PrivateScreen } from '@/features/private/components/private-screen';
import { privateModule } from '@/features/private/config/private-modules';
import {
  useAlbumEvents,
  useAlbumPlanMutations,
  type DecryptedEvent,
} from '@/features/private/hooks/use-album-plans';
import {
  useAlbumDetail,
  useAlbumKey,
  useAlbumRealtime,
} from '@/features/private/hooks/use-shared-albums';
import { usePrivateStore } from '@/features/private/store/private-store';
import { useColorScheme } from '@/hooks/use-color-scheme';

const TINT = privateModule('shared-albums')?.tint ?? moduleTints.albums;

/**
 * A date-sorted list of things the two of you mean to do — no allow_plans
 * flag (see 0038's header), so every member can read and add. `PrivateScreen`
 * reproduces every other private screen's shell, but not the shared-albums
 * `space !== 'real'` guard, which every sub-route of this module has to
 * reproduce itself (see [id].tsx and chat.tsx for the same pattern).
 */
export default function AlbumPlansScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scheme = useColorScheme() ?? 'light';
  const tint = resolveTint(TINT, scheme);
  const { t } = useTranslation();

  const space = usePrivateStore((s) => s.space);
  useAlbumRealtime(id);
  const detailQuery = useAlbumDetail(id);
  const { data } = detailQuery;
  const { data: albumKey } = useAlbumKey(id);
  const { data: events = [] } = useAlbumEvents(id, albumKey ?? null);
  const mutations = useAlbumPlanMutations(id);

  const sheetRef = useRef<BottomSheetModal>(null);
  const [target, setTarget] = useState<PlanSheetTarget | null>(null);

  // The album itself failing to load leaves every field below reading from
  // `data?.` — the send affordance disabled, the member list empty, the
  // permissions unknown — which looks like an album with nothing in it rather
  // than one that could not be reached.
  if (detailQuery.isError) {
    return (
      <PrivateScreen moduleId="shared-albums" title={t('private.plansTitle')} tint={tint}>
        <QueryError error={detailQuery.error} onRetry={() => detailQuery.refetch()} />
      </PrivateScreen>
    );
  }

  if (space !== 'real') {
    return (
      <PrivateScreen moduleId="shared-albums" title={t('private.plansTitle')} tint={tint}>
        <Text variant="muted">{t('private.albumsRealSpaceOnly')}</Text>
      </PrivateScreen>
    );
  }

  const openFor = (event: DecryptedEvent | null) => {
    setTarget(
      event
        ? {
            id: event.id,
            title: event.title ?? '',
            notes: event.notes ?? '',
            eventDate: event.eventDate,
          }
        : { id: null, title: '', notes: '', eventDate: format(new Date(), 'yyyy-MM-dd') },
    );
    sheetRef.current?.present();
  };

  const todayKey = format(new Date(), 'yyyy-MM-dd');
  const upcoming = events.filter((e) => e.eventDate >= todayKey);
  const past = events.filter((e) => e.eventDate < todayKey).reverse();

  return (
    <PrivateScreen
      moduleId="shared-albums"
      title={t('private.plansTitle')}
      subtitle={t('private.plansSubtitle')}
      tint={tint}
      footer={
        albumKey ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => openFor(null)}
            className="flex-row items-center justify-center gap-2 rounded-2xl py-4"
            style={{ backgroundColor: `${tint}29` }}
          >
            <CalendarPlus size={18} color={tint} strokeWidth={1.9} />
            <Text className="font-sora-medium" style={{ color: tint }}>
              {t('private.addPlan')}
            </Text>
          </Pressable>
        ) : null
      }
    >
      {!data?.album || !albumKey ? (
        <Text variant="muted">{t('private.albumLockedBody')}</Text>
      ) : events.length === 0 ? (
        <View className="items-center gap-2 py-16">
          <Text variant="subheading">{t('private.plansEmptyTitle')}</Text>
        </View>
      ) : (
        <>
          {upcoming.length > 0 ? (
            <View className="gap-3">
              <Text variant="micro">{t('private.upcoming')}</Text>
              {upcoming.map((event) => (
                <PlanRow key={event.id} event={event} tint={tint} onPress={() => openFor(event)} />
              ))}
            </View>
          ) : null}
          {past.length > 0 ? (
            <View className="gap-3">
              <Text variant="micro">{t('private.past')}</Text>
              {past.map((event) => (
                <PlanRow key={event.id} event={event} tint={tint} onPress={() => openFor(event)} />
              ))}
            </View>
          ) : null}
        </>
      )}

      <PlanSheet
        ref={sheetRef}
        target={target}
        tint={tint}
        albumKey={albumKey ?? null}
        mutations={mutations}
      />
    </PrivateScreen>
  );
}

function PlanRow({
  event,
  tint,
  onPress,
}: {
  event: DecryptedEvent;
  tint: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={cardClass({ padding: 'row' }, 'gap-1')}
    >
      <View className="flex-row items-center justify-between">
        <Text className="font-sora-medium text-foreground" numberOfLines={1}>
          {event.title ?? t('private.commentLocked')}
        </Text>
        <Text variant="caption" style={{ color: tint }}>
          {format(new Date(`${event.eventDate}T00:00:00`), 'd MMM yyyy')}
        </Text>
      </View>
      {event.notes ? (
        <Text variant="caption" numberOfLines={2}>
          {event.notes}
        </Text>
      ) : null}
    </Pressable>
  );
}
