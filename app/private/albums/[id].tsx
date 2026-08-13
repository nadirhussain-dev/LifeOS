import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Camera,
  CalendarDays,
  ImagePlus,
  MessageCircle,
  NotebookPen,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dimensions, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { moduleTints, resolveTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { usePlan } from '@/features/billing/hooks/use-billing';
import { decryptPhotoAsDataUri } from '@/features/private/services/album-cache';
import { AlbumCommentSheet } from '@/features/private/components/album-comment-sheet';
import { MilestoneSheet } from '@/features/private/components/milestone-sheet';
import { OnThisDayCard } from '@/features/private/components/on-this-day-card';
import { TogetherStrip } from '@/features/private/components/together-strip';
import { PrivateScreen } from '@/features/private/components/private-screen';
import { privateModule } from '@/features/private/config/private-modules';
import { SecureContentView, SecureImage } from '@/features/private/components/secure-content-view';
import {
  useAlbumMilestoneMutations,
  useAlbumMilestones,
} from '@/features/private/hooks/use-album-milestones';
import {
  useAlbumDetail,
  useAlbumKey,
  useAlbumName,
  useAlbumRealtime,
  useMyAlbumMembership,
  useSharedAlbumMutations,
} from '@/features/private/hooks/use-shared-albums';
import { onThisDay, todaysMilestone } from '@/features/private/services/together';
import type { AlbumPhoto } from '@/features/private/types/shared-album.types';
import { usePrivateStore } from '@/features/private/store/private-store';
import { ReportSheet, type ReportTarget } from '@/features/moderation/components/report-sheet';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';
import { confirm } from '@/lib/dialog-store';
import { toast } from '@/lib/toast-store';

const TINT = privateModule('shared-albums')?.tint ?? moduleTints.albums;
const GAP = 8;

/**
 * One album's photo grid.
 *
 * The full-size viewer is `SecureContentView`/`SecureImage`'s first real
 * caller — both have existed, fully built and tested, since the private
 * space's design work, with zero call sites anywhere in the app (see
 * moderation-wiring.test.ts's own account of the same shape of gap in
 * `submitReport`). The grid itself stays plain thumbnails (screenshot
 * blocking already applies to the whole screen via `_layout.tsx`); the
 * watermark and report button matter most at the moment someone is actually
 * looking closely at one photo, which is what wrapping the viewer — not
 * every thumbnail — gives you without fighting a virtualized grid's mount
 * and unmount churn.
 */
export default function SharedAlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const tint = resolveTint(TINT, scheme);
  const { t } = useTranslation();

  const space = usePrivateStore((s) => s.space);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const profile = useAuthStore((s) => s.profile);

  const { data } = useAlbumDetail(id);
  const { data: albumKey } = useAlbumKey(id);
  const { name, locked } = useAlbumName(id, data?.album?.nameCiphertext);
  const { isOwner } = useMyAlbumMembership(data);
  const { addPhoto, removePhoto, deleteAlbum, addComment, removeComment } =
    useSharedAlbumMutations(id);
  useAlbumRealtime(id);

  const { data: milestones = [] } = useAlbumMilestones(id, albumKey ?? null);
  const milestoneMutations = useAlbumMilestoneMutations(id);
  const todaysMilestoneTitle = useMemo(
    () => todaysMilestone(milestones, new Date())?.title ?? null,
    [milestones],
  );

  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<AlbumPhoto | null>(null);
  const reportSheet = useRef<BottomSheetModal>(null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const commentSheet = useRef<BottomSheetModal>(null);
  const milestoneSheet = useRef<BottomSheetModal>(null);

  const photos = data?.photos ?? [];
  const columns = 3;
  const size = (Dimensions.get('window').width - 40 - GAP * (columns - 1)) / columns;
  // Depends on `data?.photos` (the query's own stable array) rather than the
  // `photos` fallback above, which is a fresh `[]` every render whenever
  // there's no data yet and would otherwise recompute every time.
  const { isPlus } = usePlan();
  // Free: only the most recent exact anniversary. Plus: the full lookback,
  // including the oldest-photo fallback for an album with no anniversary
  // yet — see together.ts's own header for why the depth, not the feature
  // itself, is what's gated.
  const memory = useMemo(
    () => onThisDay(data?.photos ?? [], new Date(), isPlus ? 15 : 1),
    [data?.photos, isPlus],
  );

  const pick = async (source: 'library' | 'camera') => {
    if (!albumKey || !userId) return;
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 0.9,
      allowsMultipleSelection: source === 'library',
      exif: false,
    };
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled) return;

    setBusy(true);
    let failed = 0;
    let quota = false;
    try {
      for (const [index, asset] of result.assets.entries()) {
        try {
          const outcome = await addPhoto.mutateAsync({
            albumKey,
            addedBy: userId,
            uri: asset.uri,
            mimeType: asset.mimeType ?? 'image/jpeg',
            width: asset.width ?? null,
            height: asset.height ?? null,
            captionCiphertext: null,
            position: photos.length + index,
          });
          if (!outcome.ok) {
            if (outcome.reason === 'quota') quota = true;
            else failed += 1;
          }
        } catch {
          failed += 1;
        }
      }
    } finally {
      setBusy(false);
    }
    if (quota) toast.error(t('private.quotaReached'));
    else if (failed > 0) toast.error(t('private.uploadFailed'));
  };

  const confirmDeletePhoto = (photo: AlbumPhoto) =>
    void confirm({
      title: t('private.deletePhoto'),
      message: t('private.deletePhotoBody'),
      confirmLabel: t('common.remove'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
      removePhoto.mutate(photo.id);
      setSelected(null);
    });

  const confirmDeleteAlbum = () =>
    void confirm({
      title: t('private.deleteAlbumTitle'),
      message: t('private.deleteAlbumBody'),
      confirmLabel: t('private.deleteAlbum'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
      deleteAlbum.mutate(undefined, {
        onSuccess: () => router.replace('/private/albums'),
      });
    });

  /**
   * The album itself is reportable, not only a specific member — an abusive
   * album name or photos added against your will has no single member to
   * name, and "leave" is not a report. Mirrors app/split/[id].tsx's
   * group-level report entry point.
   */
  const openReportAlbum = () => {
    setReportTarget({
      reportedUserId: data?.album?.createdBy ?? null,
      surface: 'shared_space',
      surfaceId: id ?? null,
      evidence: { albumId: id, photoCount: photos.length },
      label: locked ? t('private.albumLockedTitle') : (name ?? t('private.sharedAlbumsTitle')),
    });
    reportSheet.current?.present();
  };

  if (space !== 'real') {
    return (
      <PrivateScreen moduleId="shared-albums" title={t('private.sharedAlbumsTitle')} tint={tint}>
        <Text variant="muted">{t('private.albumsRealSpaceOnly')}</Text>
      </PrivateScreen>
    );
  }

  return (
    <PrivateScreen
      moduleId="shared-albums"
      title={locked ? t('private.albumLockedTitle') : (name ?? '')}
      subtitle={t('private.itemCount', { count: photos.length })}
      tint={tint}
      footer={
        albumKey ? (
          <View className="flex-row gap-2">
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void pick('library')}
              className="flex-1 flex-row items-center justify-center gap-2 rounded-2xl py-4"
              style={{ backgroundColor: alpha(tint, 0.16), opacity: busy ? 0.5 : 1 }}
            >
              <ImagePlus size={19} color={tint} strokeWidth={1.9} />
              <Text className="font-sora-medium" style={{ color: tint }}>
                {t('private.addPhoto')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void pick('camera')}
              className="h-[52px] w-[52px] items-center justify-center rounded-2xl"
              style={{ backgroundColor: alpha(tint, 0.16), opacity: busy ? 0.5 : 1 }}
            >
              <Camera size={20} color={tint} strokeWidth={1.9} />
            </Pressable>
          </View>
        ) : null
      }
    >
      <View className="gap-2">
        <View className="flex-row gap-2">
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/private/albums/${id}/plans`)}
            className="flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-border py-2.5"
          >
            <CalendarDays size={15} color={theme.mutedForeground} />
            <Text variant="caption">{t('private.plansTitle')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/private/albums/${id}/notes`)}
            className="flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-border py-2.5"
          >
            <NotebookPen size={15} color={theme.mutedForeground} />
            <Text variant="caption">{t('private.notesTitle')}</Text>
          </Pressable>
        </View>
        <View className="flex-row gap-2">
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/private/albums/${id}/members`)}
            className="flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-border py-2.5"
          >
            <Users size={15} color={theme.mutedForeground} />
            <Text variant="caption">{t('private.members')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/private/albums/${id}/invite`)}
            className="flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-border py-2.5"
          >
            <UserPlus size={15} color={theme.mutedForeground} />
            <Text variant="caption">{t('private.invite')}</Text>
          </Pressable>
          {isOwner ? (
            <Pressable
              accessibilityRole="button"
              onPress={confirmDeleteAlbum}
              className="h-10 w-10 items-center justify-center rounded-xl border border-border"
            >
              <Trash2 size={15} color={theme.destructive} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {!locked && data ? (
        <TogetherStrip
          memberNames={data.activeMembers.map((m) => m.displayName || m.email || '?')}
          totalMembers={data.activeMembers.length}
          photoCount={photos.length}
          createdAt={data.album?.createdAt ?? Date.now()}
          tint={tint}
          showChatEntry={isOwner || !!data.album?.allowChat}
          onOpenChat={() => router.push(`/private/albums/${id}/chat`)}
          onManageMilestones={() => milestoneSheet.current?.present()}
          todaysMilestoneTitle={todaysMilestoneTitle}
          onOpenTogether={() => router.push('/private/together')}
        />
      ) : null}

      {memory && albumKey ? (
        <OnThisDayCard
          photo={memory.photo}
          yearsAgo={memory.yearsAgo}
          albumKey={albumKey}
          tint={tint}
          onPress={() => setSelected(memory.photo)}
        />
      ) : null}

      {locked ? (
        <View className="gap-3">
          <Text variant="muted">{t('private.albumLockedBody')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/private/albums/${id}/members`)}
            className="flex-row items-center justify-center gap-2 rounded-xl border border-border py-2.5"
          >
            <Users size={15} color={theme.mutedForeground} />
            <Text variant="caption">{t('private.members')}</Text>
          </Pressable>
        </View>
      ) : null}

      {photos.length === 0 ? (
        <View className="items-center gap-2 py-16">
          <Text variant="subheading">{t('private.albumsEmptyTitle')}</Text>
        </View>
      ) : (
        <View className="flex-row flex-wrap" style={{ gap: GAP }}>
          {photos.map((photo) => (
            <AlbumPhotoThumb
              key={photo.id}
              photo={photo}
              albumKey={albumKey ?? null}
              size={size}
              onPress={() => setSelected(photo)}
            />
          ))}
        </View>
      )}

      {selected ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setSelected(null)}
          className="absolute inset-0 items-center justify-center px-4"
          style={{ backgroundColor: alpha(theme.background, 0.97) }}
        >
          <SecureContentView
            viewerLabel={profile?.displayName || profile?.username || t('moderation.someone')}
            onReport={openReportAlbum}
          >
            <AlbumFullPhoto photo={selected} albumKey={albumKey ?? null} />
          </SecureContentView>
          <View className="mt-5 flex-row items-center gap-2.5">
            {data?.album && albumKey ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => commentSheet.current?.present()}
                className="flex-row items-center gap-2 rounded-full border border-border px-4 py-2.5"
              >
                <MessageCircle size={16} color={theme.foreground} />
                <Text className="text-foreground">{t('private.comments')}</Text>
              </Pressable>
            ) : null}
            {isOwner || selected.addedBy === userId ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => confirmDeletePhoto(selected)}
                className="flex-row items-center gap-2 rounded-full border px-4 py-2.5"
                style={{ borderColor: alpha(theme.destructive, 0.5) }}
              >
                <Trash2 size={17} color={theme.destructive} />
                <Text style={{ color: theme.destructive }}>{t('common.delete')}</Text>
              </Pressable>
            ) : null}
          </View>
        </Pressable>
      ) : null}

      <ReportSheet ref={reportSheet} target={reportTarget} />

      <MilestoneSheet
        ref={milestoneSheet}
        milestones={milestones}
        tint={tint}
        albumKey={albumKey ?? null}
        mutations={milestoneMutations}
      />

      <AlbumCommentSheet
        ref={commentSheet}
        tint={tint}
        mutations={{ addComment, removeComment }}
        target={
          selected && albumKey
            ? {
                photoId: selected.id,
                albumKey,
                canCompose: isOwner || !!data?.album?.allowComments,
                isOwner,
              }
            : null
        }
      />
    </PrivateScreen>
  );
}

function AlbumPhotoThumb({
  photo,
  albumKey,
  size,
  onPress,
}: {
  photo: AlbumPhoto;
  albumKey: Uint8Array | null;
  size: number;
  onPress: () => void;
}) {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!photo.remotePath || !albumKey) {
      setUri(null);
      return;
    }
    void decryptPhotoAsDataUri(photo.id, photo.remotePath, photo.mimeType, albumKey).then((u) => {
      if (!cancelled) setUri(u);
    });
    return () => {
      cancelled = true;
    };
  }, [photo.id, photo.remotePath, photo.mimeType, albumKey]);

  return (
    <Pressable
      accessibilityRole="imagebutton"
      onPress={onPress}
      style={{ width: size, height: size }}
      className="overflow-hidden rounded-xl bg-surface"
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          // No disk cache: a cached decode is a plaintext copy sitting outside
          // the encrypted store — same reasoning as vault.tsx's thumbnails.
          cachePolicy="none"
        />
      ) : null}
    </Pressable>
  );
}

function AlbumFullPhoto({ photo, albumKey }: { photo: AlbumPhoto; albumKey: Uint8Array | null }) {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!photo.remotePath || !albumKey) return;
    void decryptPhotoAsDataUri(photo.id, photo.remotePath, photo.mimeType, albumKey).then((u) => {
      if (!cancelled) setUri(u);
    });
    return () => {
      cancelled = true;
    };
  }, [photo.id, photo.remotePath, photo.mimeType, albumKey]);

  const memoUri = useMemo(() => uri, [uri]);
  if (!memoUri) return null;
  return <SecureImage uri={memoUri} />;
}
