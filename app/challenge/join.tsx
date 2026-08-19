import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { QueryError } from '@/components/ui/query-error';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { SeasonNotice } from '@/features/challenge/components/season-notice';
import { useSeasonStatus } from '@/features/challenge/hooks/use-challenge';
import { estimatedDailyMinutes } from '@/features/challenge/services/challenge-math';
import { canJoin } from '@/features/challenge/services/season-state';
import { useTheme } from '@/hooks/use-theme';
import { toast } from '@/lib/toast-store';
import { supabase } from '@/lib/supabase';

/**
 * Choosing what to commit to.
 *
 * Two things this screen has to get right, and they pull against each other.
 *
 * It has to be **honest about the cost** — the running "about N minutes a day"
 * exists so that somebody choosing Study, Sleep and Budget finds out it is a
 * twenty-minute daily commitment now rather than on day forty. The lock is
 * stated before the commit, not after.
 *
 * And it has to not read as **three new habits to take on**, which is the
 * framing that suppresses enrolment. Hence the split between the required set
 * and extras, and hence extras being described by what they buy — forgiveness,
 * never speed.
 */
export default function ChallengeJoinScreen() {
  const { t } = useTranslation();
  const { c, tint } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const season = useSeasonStatus();

  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const status = season.data ?? { state: 'none' as const };
  const required = status.requiredModules ?? 3;
  const estimates = useMemo(
    () => Object.fromEntries((status.modules ?? []).map((m) => [m.moduleId, m.estDailySeconds])),
    [status.modules],
  );

  const enough = chosen.length >= required;
  // Everything past the minimum is an extra: it earns shields sooner without
  // ever shortening the run.
  const extras = Math.max(chosen.length - required, 0);

  const toggle = (moduleId: string) =>
    setChosen((current) =>
      current.includes(moduleId) ? current.filter((id) => id !== moduleId) : [...current, moduleId],
    );

  const join = async () => {
    if (!status.seasonId || !enough || busy) return;
    setBusy(true);
    try {
      // The first `required` chosen form the contract; the rest are extras.
      // Order is the order they were tapped, which is the only ranking the user
      // has actually given us.
      const { error } = await supabase.rpc('enroll_in_challenge', {
        p_season: status.seasonId,
        p_tz_offset_minutes: -new Date().getTimezoneOffset(),
        p_required: chosen.slice(0, required),
        p_extra: chosen.slice(required),
        p_device_id: null,
      });
      if (error) throw new Error(error.message);

      await queryClient.invalidateQueries({ queryKey: ['challenge'] });
      router.back();
    } catch {
      toast.error(t('challenge.enrolFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('challenge.joinTitle')}
        eyebrow={t('challenge.eyebrow')}
        tint={tint('habit')}
      />

      <ScrollView
        contentContainerClassName="gap-4 px-5 pt-3 pb-10"
        showsVerticalScrollIndicator={false}
      >
        {season.isError ? (
          <QueryError onRetry={() => void season.refetch()} />
        ) : !canJoin(status.state) ? (
          /*
            Reached by anybody deep-linked here, or still holding the screen
            when a season closes under them. It states which season and why —
            the same sentence the challenge screen shows — rather than the flat
            "no season is open" that used to stand in for six situations.
          */
          <View className={cardClass({ padding: 'md' }, 'gap-1')}>
            <SeasonNotice status={status} />
          </View>
        ) : (
          <>
            <Text variant="muted">{t('challenge.joinLead', { count: required })}</Text>

            {/* What is being joined, stated before the picker rather than
                nowhere at all: the name, and the date it runs to. Somebody
                choosing three commitments for a year is entitled to know the
                length of the year first. */}
            <View className={cardClass({ padding: 'md' }, 'gap-1')}>
              <SeasonNotice status={status} />
            </View>

            <View className={cardClass({ padding: 'md' }, 'gap-1')}>
              <Text variant="micro">{t('challenge.joinRequired')}</Text>
              {(status.modules ?? []).map((module, index) => {
                const picked = chosen.includes(module.moduleId);
                const rank = chosen.indexOf(module.moduleId);
                return (
                  <Pressable
                    key={module.moduleId}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: picked }}
                    onPress={() => toggle(module.moduleId)}
                    className="flex-row items-center gap-3 py-2.5"
                    style={index > 0 ? { borderTopWidth: 1, borderTopColor: c.border } : undefined}
                  >
                    <View
                      className="h-6 w-6 items-center justify-center rounded-md"
                      style={
                        picked
                          ? { backgroundColor: c.accent }
                          : { borderWidth: 2, borderColor: c.border }
                      }
                    >
                      {picked ? <Check size={14} color={c.background} strokeWidth={3} /> : null}
                    </View>

                    <Text className="flex-1 font-sora-semibold">
                      {t(`syncModule.${module.moduleId}`)}
                    </Text>

                    {picked && rank >= required ? (
                      <Text variant="caption" style={{ color: c.accent }}>
                        {t('challenge.joinExtra')}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>

            <View className={cardClass({ padding: 'md' }, 'gap-2')}>
              <Text className="font-sora-semibold">
                {t('challenge.estimate', {
                  minutes: estimatedDailyMinutes(chosen, estimates),
                })}
              </Text>
              <Text variant="caption">
                {t('challenge.lockNotice', { days: status.moduleLockDays ?? 30 })}
              </Text>
              {/* The live-write rule, stated before the commit for the same
                  reason the lock is: it is the single most surprising way to
                  lose a day, and finding out about it on day forty — having
                  just lost one on a train — is the version that produces a
                  one-star review rather than a shrug. Shown whenever the
                  season carries the rule, not conditionally on the picker. */}
              {status.requireLiveWrites ? (
                <Text variant="caption" style={{ color: c.warning }}>
                  {t('challenge.liveRuleNotice')}
                </Text>
              ) : null}
              {extras > 0 ? <Text variant="caption">{t('challenge.joinExtraBody')}</Text> : null}
            </View>

            <Button
              label={
                enough ? t('challenge.confirm') : t('challenge.pickAtLeast', { count: required })
              }
              onPress={() => void join()}
              disabled={!enough || busy}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}
