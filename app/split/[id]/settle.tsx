import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { HandCoins } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { ArrowForward } from '@/components/ui/directional-icon';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineError } from '@/components/ui/query-error';
import { SheetHeader } from '@/components/ui/sheet-header';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { formatMoney } from '@/features/budget/services/money';
import { MemberAvatars } from '@/features/split/components/member-avatars';
import {
  useGroupBalances,
  useGroupDetail,
  useSplitMutations,
} from '@/features/split/hooks/use-split';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';
import { toast } from '@/lib/toast-store';

/**
 * Settling up.
 *
 * The suggestions come from simplifyDebts, which minimises the number of
 * payments rather than preserving who-owed-whom — so a transfer here may be to
 * somebody you never directly shared a bill with. That is the point: it clears
 * the group in at most n−1 payments instead of everyone paying everyone.
 */
export default function SettleUpScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const tint = moduleTint('budget', scheme);

  const { data } = useGroupDetail(id);
  const { transfers } = useGroupBalances(data);
  const { settleUp } = useSplitMutations(id);

  const currency = data?.group?.currency ?? '$';
  const memberName = (memberId: string) => {
    const m = data?.members.find((x) => x.id === memberId);
    return m?.displayName || m?.email || t('split.someone');
  };

  const record = (fromMemberId: string, toMemberId: string, amountCents: number) => {
    settleUp.mutate(
      { fromMemberId, toMemberId, amountCents, currency, note: null },
      {
        // Was firing a success haptic on tap, so a failed settlement still felt
        // like a completed payment — the worst place in the app for that.
        onSuccess: () => {
          toast.success(t('split.settlementRecorded'));
          router.back();
        },
        onError: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
      },
    );
  };

  const hasExpenses = (data?.expenses.length ?? 0) > 0;

  return (
    <View className="flex-1 bg-background">
      <SheetHeader title={t('split.settleUp')} />

      {transfers.length === 0 ? (
        <EmptyState
          icon={HandCoins}
          title={t('split.allSquareTitle')}
          // "Nobody owes anybody" is true but unhelpful in a brand new group;
          // say what to do instead.
          description={hasExpenses ? t('split.allSquareBody') : t('split.settleEmptyHint')}
          tint={tint}
        />
      ) : (
        <ScrollView contentContainerClassName="gap-3 px-5 pt-3 pb-10">
          <Text variant="caption">{t('split.settleHint')}</Text>

          {transfers.map((transfer, index) => {
            const from = memberName(transfer.fromMemberId);
            const to = memberName(transfer.toMemberId);
            const amount = formatMoney(transfer.amountCents, currency);
            return (
              <Pressable
                key={`${transfer.fromMemberId}-${transfer.toMemberId}-${index}`}
                onPress={() =>
                  record(transfer.fromMemberId, transfer.toMemberId, transfer.amountCents)
                }
                disabled={settleUp.isPending}
                accessibilityRole="button"
                accessibilityState={{ disabled: settleUp.isPending }}
                // The visual row reads "A → B" with the amount in a chip below;
                // spoken, that needs to be one sentence.
                accessibilityLabel={t('split.settleA11y', { from, to, amount })}
                className={cardClass({ padding: 'md' }, 'gap-3')}
                style={{ opacity: settleUp.isPending ? 0.6 : 1 }}
              >
                <View className="flex-row items-center gap-2">
                  <MemberAvatars names={[from]} total={1} size={24} />
                  <Text className="flex-1 font-sora-medium text-foreground" numberOfLines={1}>
                    {from}
                  </Text>
                  {/* Direction has to flip in Arabic/Urdu — a hardcoded
                      ArrowRight pointed at the payer there. */}
                  <ArrowForward size={15} color={colors[scheme].mutedForeground} />
                  <Text
                    className="flex-1 text-end font-sora-medium text-foreground"
                    numberOfLines={1}
                  >
                    {to}
                  </Text>
                  <MemberAvatars names={[to]} total={1} size={24} />
                </View>
                <View
                  className="items-center rounded-xl py-2"
                  style={{ backgroundColor: alpha(tint, 0.12) }}
                >
                  <Text className="font-sora-bold" style={{ color: tint }}>
                    {t('split.markPaid', { amount })}
                  </Text>
                </View>
              </Pressable>
            );
          })}

          {settleUp.isError ? <InlineError error={settleUp.error} /> : null}
        </ScrollView>
      )}
    </View>
  );
}
