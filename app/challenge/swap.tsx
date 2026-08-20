import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { ArrowForward } from '@/components/ui/directional-icon';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { useChallengeToday, useSeasonStatus } from '@/features/challenge/hooks/use-challenge';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast-store';

/**
 * Trading one commitment for another.
 *
 * A year is long enough that somebody genuinely stops studying or changes jobs,
 * and a contract with no exit turns those people into quitters rather than
 * swappers. Two a season covers real life without covering laziness.
 *
 * The screen says plainly that the change lands **tomorrow**, because that is
 * the rule most likely to be misread and the misreading is expensive: somebody
 * who swaps at 23:00 believing it rescues today would lose the day and blame
 * the app. The server enforces it either way — `swap_challenge_module` never
 * backdates — but a rule the user finds out about by losing a day is a rule
 * that was documented too late.
 */
export default function ChallengeSwapScreen() {
  const { t } = useTranslation();
  const { c, tint } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const today = useChallengeToday();
  const season = useSeasonStatus();

  const [out, setOut] = useState<string | null>(null);
  const [into, setInto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const committed = today.data?.required ?? [];
  const available = (season.data?.modules ?? [])
    .map((m) => m.moduleId)
    .filter((id) => !committed.includes(id));

  const swapsLeft = today.data?.swapsLeft ?? 0;
  const unlockDay = today.data?.swapsUnlockDay ?? '';
  // Compared as ISO date strings, which sort lexicographically — no parsing,
  // and no timezone to get wrong on either side.
  const locked = Boolean(unlockDay) && (today.data?.localDay ?? '') < unlockDay;
  const blocked = locked || swapsLeft === 0;

  const swap = async () => {
    if (!out || !into || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('swap_challenge_module', { p_out: out, p_in: into });
      if (error) throw new Error(error.message);
      await queryClient.invalidateQueries({ queryKey: ['challenge'] });
      router.back();
    } catch {
      // The server owns the rules this can fail on — the 30-day lock, the swap
      // budget, eligibility — so the message stays general rather than
      // guessing which one it was.
      toast.error(t('challenge.swapFailed'));
    } finally {
      setBusy(false);
    }
  };

  const Row = ({
    moduleId,
    selected,
    onPress,
  }: {
    moduleId: string;
    selected: boolean;
    onPress: () => void;
  }) => (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      className="flex-row items-center gap-3 py-3"
    >
      <View
        className="h-5 w-5 rounded-full"
        style={{
          borderWidth: 2,
          borderColor: selected ? c.accent : c.border,
          backgroundColor: selected ? c.accent : 'transparent',
        }}
      />
      <Text className="flex-1 font-sora-medium text-foreground">{t(`syncModule.${moduleId}`)}</Text>
    </Pressable>
  );

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('challenge.swapTitle')}
        eyebrow={t('challenge.eyebrow')}
        tint={tint('habit')}
      />

      <ScrollView
        contentContainerClassName="gap-4 px-5 pt-3 pb-10"
        showsVerticalScrollIndicator={false}
      >
        <Text variant="muted">{t('challenge.swapLead')}</Text>

        {/* State the two rules that can refuse this, before somebody spends a
            minute choosing and then gets turned away by the server. */}
        <Text variant="caption" style={{ color: locked || swapsLeft === 0 ? c.warning : c.accent }}>
          {locked
            ? t('challenge.swapLocked', { day: unlockDay })
            : swapsLeft === 0
              ? t('challenge.swapNone')
              : t('challenge.swapLeft', { count: swapsLeft })}
        </Text>

        <View className={cardClass({ padding: 'md' }, 'gap-1')}>
          <Text variant="micro">{t('challenge.swapOut')}</Text>
          {today.isLoading ? <ListSkeleton rows={3} /> : null}
          {committed.map((moduleId) => (
            <Row
              key={moduleId}
              moduleId={moduleId}
              selected={out === moduleId}
              onPress={() => setOut(moduleId)}
            />
          ))}
        </View>

        <View className="items-center">
          <ArrowForward size={18} color={c.mutedForeground} />
        </View>

        <View className={cardClass({ padding: 'md' }, 'gap-1')}>
          <Text variant="micro">{t('challenge.swapIn')}</Text>
          {season.isLoading ? <ListSkeleton rows={3} /> : null}
          {available.map((moduleId) => (
            <Row
              key={moduleId}
              moduleId={moduleId}
              selected={into === moduleId}
              onPress={() => setInto(moduleId)}
            />
          ))}
        </View>

        <Button
          label={t('challenge.swapConfirm')}
          onPress={() => void swap()}
          disabled={!out || !into || busy || blocked}
        />
      </ScrollView>
    </View>
  );
}
