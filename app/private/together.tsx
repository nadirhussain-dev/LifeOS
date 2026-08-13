import { format, parseISO } from 'date-fns';
import { useRouter } from 'expo-router';
import {
  CalendarHeart,
  Droplets,
  ImagePlus,
  MessagesSquare,
  NotebookPen,
} from 'lucide-react-native';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import { Pressable, Switch, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { moduleTints, resolveTint } from '@/constants/design-tokens';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { AlbumDateField } from '@/features/private/components/album-date-field';
import { MilestoneSheet } from '@/features/private/components/milestone-sheet';
import { OnThisDayCard } from '@/features/private/components/on-this-day-card';
import { PrivateScreen } from '@/features/private/components/private-screen';
import { filterByRole, privateModule } from '@/features/private/config/private-modules';
import {
  useAlbumMilestoneMutations,
  useAlbumMilestones,
} from '@/features/private/hooks/use-album-milestones';
import {
  useAlbumDetail,
  useAlbumKey,
  useAlbumName,
  useAlbumRealtime,
  useSharedAlbumMutations,
  useTogetherHub,
} from '@/features/private/hooks/use-shared-albums';
import { encryptCycleShare, tryDecryptCycleShare } from '@/features/private/services/album-crypto';
import { listCycleEntries } from '@/features/private/services/cycle';
import {
  averageCycleLength,
  dayOfCycle,
  periodsFrom,
  predictedNextStart,
} from '@/features/private/services/cycle-math';
import { nextMilestone, onThisDay, todaysMilestone } from '@/features/private/services/together';
import { usePrivateStore } from '@/features/private/store/private-store';
import { useProfileStore } from '@/features/profile/store/profile-store';
import type { SharedAlbum } from '@/features/private/types/shared-album.types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';
import { confirm } from '@/lib/dialog-store';

const TINT = privateModule('together')?.tint ?? moduleTints.albums;

/**
 * "Together" as its own place, rather than TogetherStrip's day-count strip
 * inside whichever album screen happens to render it. Not a new data model —
 * see use-shared-albums.ts's `useTogetherHub` — this is one designated shared
 * album, read back as a relationship rather than a photo library: a real
 * start date, the milestone list, the "on this day" memory, and doors into
 * that album's chat/notes/photos.
 */
export default function TogetherScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const tint = resolveTint(TINT, scheme);
  const { t } = useTranslation();
  const space = usePrivateStore((s) => s.space);
  const session = useAuthStore((s) => s.session);

  const { albums = [], hub } = useTogetherHub();
  const { setTogetherHub } = useSharedAlbumMutations();

  if (space !== 'real') {
    return (
      <PrivateScreen moduleId="together" title={t('private.togetherModuleTitle')} tint={tint}>
        <Text variant="muted">{t('private.albumsRealSpaceOnly')}</Text>
      </PrivateScreen>
    );
  }

  // Together is one designated shared album (use-shared-albums.ts's
  // useTogetherHub) — same authenticated-only backend as albums/index.tsx,
  // same guard, for the same reason (see that screen's header).
  if (!session) {
    return (
      <PrivateScreen moduleId="together" title={t('private.togetherModuleTitle')} tint={tint}>
        <View className="items-center gap-3 py-10">
          <Text variant="subheading" className="text-center">
            {t('private.albumsSignInTitle')}
          </Text>
          <Text variant="muted" className="text-center">
            {t('private.albumsSignInBody')}
          </Text>
          <Button
            variant="accent"
            label={t('sync.signInCreate')}
            onPress={() => router.push('/(auth)/login')}
          />
        </View>
      </PrivateScreen>
    );
  }

  if (hub) return <TogetherHubView hub={hub} tint={tint} />;

  return (
    <PrivateScreen
      moduleId="together"
      title={t('private.togetherModuleTitle')}
      subtitle={t('private.togetherModuleSubtitle')}
      tint={tint}
    >
      <View className="items-center gap-2 py-4">
        <Text variant="subheading" className="text-center">
          {t('private.togetherNoHubTitle')}
        </Text>
        <Text variant="muted" className="text-center">
          {t('private.togetherNoHubBody')}
        </Text>
      </View>

      {albums.length === 0 ? (
        <View className="items-center gap-3 py-4">
          <Text variant="muted">{t('private.togetherNoAlbumsYet')}</Text>
          <Button
            variant="accent"
            label={t('private.togetherCreateAlbum')}
            onPress={() => router.push('/private/albums/new')}
          />
        </View>
      ) : (
        <View className="gap-2">
          {albums.map((album) => (
            <AlbumPickRow
              key={album.id}
              album={album}
              tint={tint}
              onMakeHub={() =>
                setTogetherHub.mutate({ targetAlbumId: album.id, previousHubId: null })
              }
            />
          ))}
        </View>
      )}
    </PrivateScreen>
  );
}

function AlbumPickRow({
  album,
  tint,
  onMakeHub,
}: {
  album: SharedAlbum;
  tint: string;
  onMakeHub: () => void;
}) {
  const { t } = useTranslation();
  const { name, locked } = useAlbumName(album.id, album.nameCiphertext);

  return (
    <View
      className={cardClass({ padding: 'rowLg' }, 'flex-row items-center justify-between gap-3')}
    >
      <Text className="flex-1 font-sora-medium text-foreground" numberOfLines={1}>
        {locked ? t('private.albumLockedTitle') : (name ?? '')}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onMakeHub}
        className="rounded-full px-3.5 py-2"
        style={{ backgroundColor: alpha(tint, 0.16) }}
      >
        <Text className="font-sora-medium text-sm" style={{ color: tint }}>
          {t('private.togetherMakeHub')}
        </Text>
      </Pressable>
    </View>
  );
}

function QuickLink({
  icon: Icon,
  label,
  onPress,
}: {
  icon: typeof MessagesSquare;
  label: string;
  onPress: () => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="flex-1 items-center gap-1.5 rounded-xl border border-border py-3"
    >
      <Icon size={17} color={theme.mutedForeground} />
      <Text variant="caption">{label}</Text>
    </Pressable>
  );
}

function TogetherHubView({ hub, tint }: { hub: SharedAlbum; tint: string }) {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const { t } = useTranslation();

  useAlbumRealtime(hub.id);
  const { data: albumKey } = useAlbumKey(hub.id);
  const { name, locked } = useAlbumName(hub.id, hub.nameCiphertext);
  const { data: detail } = useAlbumDetail(hub.id);
  const { data: milestones = [] } = useAlbumMilestones(hub.id, albumKey ?? null);
  const milestoneMutations = useAlbumMilestoneMutations(hub.id);
  const { clearTogetherHub, setRelationshipStartDate, setCycleShare } = useSharedAlbumMutations(
    hub.id,
  );
  const milestoneSheet = useRef<BottomSheetModal>(null);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const gender = useProfileStore((s) => s.gender);
  const showAllModules = usePrivateStore((s) => s.showAllModules);

  // Sharing *your own* cycle status only makes sense for someone who can
  // access the Cycle module in the first place — same gate as the module
  // card itself (private-modules.ts's `hardGateByRole`), so this toggle
  // never offers to share data a `male`/unanswered account has no tracker
  // for. Viewing a *partner's* already-shared summary (`partnerCycleSummary`
  // below) is a separate concern and stays ungated — the viewer's own gender
  // has no bearing on whether they're allowed to see what their partner sent.
  const canShareCycle = filterByRole(['cycle'], gender, showAllModules).length > 0;

  const isSharingCycle = hub.cycleShareCiphertext !== null && hub.cycleShareAuthorId === userId;
  const partnerCycleSummary = useMemo(() => {
    if (!albumKey || !hub.cycleShareCiphertext) return null;
    if (!hub.cycleShareAuthorId || hub.cycleShareAuthorId === userId) return null;
    const json = tryDecryptCycleShare(albumKey, hub.cycleShareCiphertext);
    if (!json) return null;
    try {
      return JSON.parse(json) as { dayOfCycle: number | null; predictedNextStart: string | null };
    } catch {
      return null;
    }
  }, [albumKey, hub.cycleShareCiphertext, hub.cycleShareAuthorId, userId]);

  const shareCurrentCycleSummary = () => {
    if (!albumKey || !userId) return;
    const periods = periodsFrom(listCycleEntries());
    const average = averageCycleLength(periods);
    const summary = JSON.stringify({
      dayOfCycle: dayOfCycle(periods),
      predictedNextStart: predictedNextStart(periods, average),
    });
    setCycleShare.mutate(encryptCycleShare(albumKey, summary));
  };

  // Keeps an already-on share fresh every time this screen opens, since
  // there is no cross-module hook from cycle.tsx's own saves into this
  // album's ciphertext — see cycle-reminders.ts's header for the similar
  // trade-off it makes for the same reason (avoiding tight coupling between
  // two otherwise-independent private modules).
  useEffect(() => {
    if (isSharingCycle && albumKey) shareCurrentCycleSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumKey]);

  const startDate = hub.relationshipStartDate ?? hub.createdAt;
  const today = useMemo(() => todaysMilestone(milestones, new Date()), [milestones]);
  const next = useMemo(() => nextMilestone(milestones, new Date()), [milestones]);
  const memory = useMemo(() => onThisDay(detail?.photos ?? [], new Date(), 15), [detail?.photos]);

  const confirmRemoveHub = () =>
    void confirm({
      title: t('private.togetherRemoveHubTitle'),
      message: t('private.togetherRemoveHubBody'),
      confirmLabel: t('private.togetherRemoveHub'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then((ok) => {
      if (ok) clearTogetherHub.mutate(hub.id);
    });

  return (
    <PrivateScreen
      moduleId="together"
      title={locked ? t('private.albumLockedTitle') : (name ?? '')}
      tint={tint}
    >
      {locked ? (
        <View className="gap-3">
          <Text variant="muted">{t('private.togetherLocked')}</Text>
          <Button
            variant="secondary"
            label={t('private.members')}
            onPress={() => router.push(`/private/albums/${hub.id}/members`)}
          />
        </View>
      ) : (
        <>
          <View className={cardClass({ padding: 'md' }, 'gap-3')}>
            <Text className="font-sora-extrabold text-2xl" style={{ color: tint }}>
              {t('private.togetherFor', {
                count: Math.max(0, Math.floor((Date.now() - startDate) / (24 * 60 * 60 * 1000))),
              })}
            </Text>
            <View className="flex-row items-center justify-between">
              <Text variant="caption">{t('private.togetherStartDate')}</Text>
              <AlbumDateField
                value={format(new Date(startDate), 'yyyy-MM-dd')}
                onChange={(value) => setRelationshipStartDate.mutate(parseISO(value).getTime())}
              />
            </View>
          </View>

          {today?.title ? (
            <Text variant="caption" className="text-center" style={{ color: tint }}>
              {t('private.todaysMilestone', { title: today.title })}
            </Text>
          ) : next?.milestone.title ? (
            <Text variant="caption" className="text-center">
              {t('private.togetherNextMilestoneIn', {
                title: next.milestone.title,
                count: next.daysAway,
              })}
            </Text>
          ) : null}

          {memory && albumKey ? (
            <OnThisDayCard
              photo={memory.photo}
              yearsAgo={memory.yearsAgo}
              albumKey={albumKey}
              tint={tint}
              onPress={() => router.push(`/private/albums/${hub.id}`)}
            />
          ) : null}

          <View className="flex-row gap-2">
            <QuickLink
              icon={MessagesSquare}
              label={t('private.openChat')}
              onPress={() => router.push(`/private/albums/${hub.id}/chat`)}
            />
            <QuickLink
              icon={NotebookPen}
              label={t('private.notesTitle')}
              onPress={() => router.push(`/private/albums/${hub.id}/notes`)}
            />
            <QuickLink
              icon={ImagePlus}
              label={t('private.togetherViewAlbum')}
              onPress={() => router.push(`/private/albums/${hub.id}`)}
            />
          </View>

          {partnerCycleSummary ? (
            <View className={cardClass({ padding: 'md' }, 'gap-1')}>
              <View className="flex-row items-center gap-2">
                <Droplets size={15} color={tint} />
                <Text className="font-sora-medium text-foreground">
                  {partnerCycleSummary.dayOfCycle
                    ? t('private.dayOfCycle') + ` · ${partnerCycleSummary.dayOfCycle}`
                    : t('private.noPeriodsYet')}
                </Text>
              </View>
              {partnerCycleSummary.predictedNextStart ? (
                <Text variant="caption">
                  {t('private.estimatedNext', {
                    date: format(parseISO(partnerCycleSummary.predictedNextStart), 'd MMM'),
                  })}
                </Text>
              ) : null}
            </View>
          ) : null}

          {canShareCycle ? (
            <View className={cardClass({ padding: 'none' }, 'px-4')}>
              <View className="flex-row items-center gap-3 py-3.5">
                <Droplets size={17} color={theme.mutedForeground} />
                <View className="flex-1">
                  <Text className="font-sora-medium text-foreground">
                    {t('private.togetherShareCycle')}
                  </Text>
                  <Text variant="caption">{t('private.togetherShareCycleHint')}</Text>
                </View>
                <Switch
                  value={isSharingCycle}
                  onValueChange={(next) =>
                    next ? shareCurrentCycleSummary() : setCycleShare.mutate(null)
                  }
                  trackColor={{ true: tint, false: theme.border }}
                />
              </View>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            onPress={() => milestoneSheet.current?.present()}
            className="flex-row items-center justify-center gap-2 rounded-xl border border-border py-2.5"
          >
            <CalendarHeart size={15} color={theme.mutedForeground} />
            <Text variant="caption">{t('private.manageMilestones')}</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={confirmRemoveHub}
            className="items-center py-2"
          >
            <Text variant="caption" className="text-destructive">
              {t('private.togetherRemoveHub')}
            </Text>
          </Pressable>
        </>
      )}

      <MilestoneSheet
        ref={milestoneSheet}
        milestones={milestones}
        tint={tint}
        albumKey={albumKey ?? null}
        mutations={milestoneMutations}
      />
    </PrivateScreen>
  );
}
