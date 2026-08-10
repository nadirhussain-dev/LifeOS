import { format } from 'date-fns';
import { ShieldAlert } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cardClass } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { useAccountStanding } from '@/features/moderation/hooks/use-account-standing';
import { exportOwnServerData } from '@/features/moderation/services/self-data-export';
import { useModerationStore } from '@/features/moderation/store/moderation-store';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { notify } from '@/lib/dialog-store';

const APPEAL_EMAIL = 'nh262464@gmail.com';

/**
 * Shown when the account is blocked. Covers the whole app, and there is no way
 * past it while the block stands.
 *
 * It used to say the local data was safe and offer sign-out as an escape into
 * guest mode. Both were true and both are now wrong: a block wipes the device
 * (migration 0019), and an escape hatch into guest mode with every row intact
 * meant a blocked account could keep using the app and keep the material it was
 * blocked over. Sign-out is still offered — trapping somebody in a screen with
 * no exit is its own kind of broken — but by the time it is reachable the wipe
 * has already run, so it leads to an empty app rather than a full one.
 *
 * What the screen owes the person, and now gives them: the reason, when it
 * ends, a way to appeal, and — the part that is easy to leave out — a specific
 * account of what was destroyed and what will come back if the block is lifted.
 */
export function BlockedOverlay() {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { standing, status } = useAccountStanding();
  const wipeOutcome = useModerationStore((s) => s.wipeOutcome);
  const signOut = useAuthStore((s) => s.signOut);
  const [exporting, setExporting] = useState(false);

  const handleDownload = () => {
    setExporting(true);
    void exportOwnServerData()
      .then((result) => {
        if (result.ok) return;
        // Partial or total failure both get said out loud. Somebody exercising a
        // data-access right needs to know whether they have all of it.
        void notify({
          title: t('moderation.downloadFailedTitle'),
          message:
            result.exported.length > 0
              ? t('moderation.downloadPartial', { count: result.failed.length })
              : t('moderation.downloadFailedBody'),
          confirmLabel: t('common.ok'),
        });
      })
      .finally(() => setExporting(false));
  };

  if (status !== 'blocked') return null;

  const until = standing?.expiresAt
    ? format(new Date(standing.expiresAt), 'd MMM yyyy, HH:mm')
    : null;

  return (
    <View
      className="absolute inset-0 items-center justify-center bg-background px-8"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
    >
      <View className="w-full items-center gap-5">
        <View className="h-20 w-20 items-center justify-center rounded-3xl bg-surface">
          <ShieldAlert size={34} color={colors[scheme].destructive} strokeWidth={1.8} />
        </View>

        <View className="items-center gap-2">
          <Text variant="heading" className="text-center">
            {t('moderation.blockedTitle')}
          </Text>
          <Text variant="muted" className="text-center">
            {until ? t('moderation.blockedUntil', { date: until }) : t('moderation.blockedBody')}
          </Text>
        </View>

        {standing?.reason ? (
          <View className={cardClass({ padding: 'row' }, 'w-full')}>
            <Text variant="caption" className="font-sora-semibold uppercase tracking-wide">
              {t('moderation.reason')}
            </Text>
            <Text className="mt-1 text-foreground">{standing.reason}</Text>
          </View>
        ) : null}

        {/* What the wipe cost, said specifically. A vague "your data was
            removed" is what turns a moderation action into a support thread. */}
        {wipeOutcome ? (
          <View className={cardClass({ padding: 'row' }, 'w-full gap-1')}>
            <Text variant="caption" className="font-sora-semibold uppercase tracking-wide">
              {t('moderation.wipedTitle')}
            </Text>
            <Text className="mt-1 text-foreground">{t('moderation.wipedBody')}</Text>
            {wipeOutcome.unsaved.length > 0 ? (
              <Text variant="muted" className="mt-1">
                {wipeOutcome.unsaved.includes('*')
                  ? t('moderation.wipedNothingSaved')
                  : t('moderation.wipedUnsaved', {
                      modules: wipeOutcome.unsaved
                        .map((module) => t(`syncModule.${module}`))
                        .join(', '),
                    })}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View className="w-full gap-2 pt-2">
          <Button
            variant="accent"
            size="lg"
            label={t('moderation.appeal')}
            onPress={() =>
              void Linking.openURL(
                `mailto:${APPEAL_EMAIL}?subject=${encodeURIComponent(t('moderation.appealSubject'))}`,
              )
            }
          />
          {/*
            The obligation the block would otherwise break. A blocked account has
            had its device wiped and has every server read refused, so it holds
            no copy of its data and has no way to fetch one — while GDPR Art. 15
            still entitles it to exactly that. Being blocked by us is not a
            lawful basis for withholding somebody's own data, and "email us and
            an admin will run some SQL" is an obligation discharged by somebody
            remembering to. This goes straight through migration 0022.
          */}
          <Button
            variant="secondary"
            size="lg"
            label={exporting ? t('moderation.downloadingData') : t('moderation.downloadData')}
            disabled={exporting}
            onPress={handleDownload}
          />
          <Button
            variant="ghost"
            size="lg"
            label={t('sync.signOut')}
            onPress={() => void signOut()}
          />
        </View>
      </View>
    </View>
  );
}
