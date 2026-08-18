import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { seasonNotice, type SeasonStatus } from '@/features/challenge/services/season-state';

/**
 * What the programme is doing, in words, wherever a screen needs to say it.
 *
 * One component because the answer has to be identical in all three places it
 * appears — the challenge screen, the join screen, and the operator console's
 * preview of what users are seeing. Three hand-written versions of "the season
 * has not started yet" is how they end up disagreeing about which season, or
 * about the date.
 *
 * The date is formatted here rather than in `seasonNotice`, in the viewer's own
 * locale and calendar: the same instant reads as "14 November" for one user and
 * ۱۴ نومبر for another, and the function deciding *what* to say has no business
 * deciding either.
 */
export function SeasonNotice({
  status,
  compact = false,
}: {
  status: SeasonStatus;
  /** Drops the heading, for callers that already have one above it. */
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const notice = seasonNotice(status);

  const date = notice.dateIso
    ? new Date(notice.dateIso).toLocaleDateString(i18n.language, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '';

  return (
    <View className="gap-1">
      {compact ? null : (
        <Text className="font-sora-semibold text-foreground">
          {t(notice.titleKey, notice.values)}
        </Text>
      )}
      <Text variant="caption">{t(notice.bodyKey, { ...notice.values, date })}</Text>
      {/*
        Seats are a fact about the season, not about its state, so they hang off
        the notice rather than being folded into it — a cap is worth knowing
        about while there is still room, and "3 places left" is the difference
        between joining today and meaning to.

        `!= null` on purpose: an uncapped season sends null and a full one sends
        0, and `0` is a real answer that a truthiness check would hide at
        exactly the moment it matters most.
      */}
      {status.seatsLeft != null && status.state === 'open' ? (
        <Text variant="caption">{t('challenge.seatsLeft', { count: status.seatsLeft })}</Text>
      ) : null}
    </View>
  );
}
