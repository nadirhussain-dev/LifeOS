import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, RotateCcw } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { ScreenHeader } from '@/components/ui/screen-header';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { usePlans } from '@/features/billing/hooks/use-billing';
import {
  createCoupon,
  isOwner,
  listCoupons,
  setCouponActive,
  type Coupon,
} from '@/features/operator/services/operator-repository';
import { useTheme } from '@/hooks/use-theme';
import { alpha } from '@/lib/color';
import { toast } from '@/lib/toast-store';

const DAY_MS = 86_400_000;

type FormState = {
  code: string;
  discountType: 'percent' | 'fixed';
  discountValue: string;
  durationCycles: string;
  maxRedemptions: string;
  validDays: string;
  planIds: Set<string>;
};

const blankForm = (): FormState => ({
  code: '',
  discountType: 'percent',
  discountValue: '',
  durationCycles: '1',
  maxRedemptions: '',
  validDays: '',
  planIds: new Set(),
});

/**
 * Coupons — owner-only, both to see this row (operator.tsx) and to call
 * every RPC behind it (0048), the same "moves real money, gated on
 * `is_owner()`, never merely `is_admin()`" discipline 0033 already applies
 * to the roster. A coupon only ever changes what `safepay-checkout` charges
 * at the moment of subscribing — it cannot touch anyone already subscribed.
 */
export default function OperatorCouponsScreen() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const queryClient = useQueryClient();

  const [owner, setOwner] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void isOwner().then(setOwner);
  }, []);

  const { data: plans = [] } = usePlans();
  const paidPlans = plans.filter((p) => p.period !== 'free');
  const coupons = useQuery({ queryKey: ['operator', 'coupons'], queryFn: listCoupons });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['operator', 'coupons'] });

  const togglePlan = (planId: string) =>
    setForm((f) => {
      if (!f) return f;
      const planIds = new Set(f.planIds);
      if (planIds.has(planId)) planIds.delete(planId);
      else planIds.add(planId);
      return { ...f, planIds };
    });

  const save = async () => {
    if (!form) return;
    const code = form.code.trim().toUpperCase();
    const discountValue = Math.round(Number(form.discountValue));
    const durationCycles = Math.max(1, Math.round(Number(form.durationCycles) || 1));
    if (!code || !Number.isFinite(discountValue) || discountValue <= 0) return;

    setBusy(true);
    const now = Date.now();
    const result = await createCoupon({
      code,
      discountType: form.discountType,
      discountValue,
      durationCycles,
      maxRedemptions: form.maxRedemptions.trim() ? Number(form.maxRedemptions) : null,
      startsAt: now,
      endsAt: form.validDays.trim() ? now + Number(form.validDays) * DAY_MS : null,
      planIds: form.planIds.size > 0 ? Array.from(form.planIds) : null,
    });
    setBusy(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t('operator.couponCreated', { code }));
    setForm(null);
    refresh();
  };

  const toggleActive = async (coupon: Coupon, active: boolean) => {
    setBusy(true);
    const result = await setCouponActive(coupon.id, active, coupon.endsAt, coupon.maxRedemptions);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    refresh();
  };

  if (!owner) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <Text variant="caption">{t('operator.couponsOwnerOnly')}</Text>
      </View>
    );
  }

  const list = coupons.data?.ok ? coupons.data.data : [];

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        eyebrow={t('operator.eyebrow')}
        title={t('operator.couponsTitle')}
        subtitle={t('operator.couponsSubtitle')}
        tint={c.error}
      />

      <ScrollView contentContainerClassName="gap-3 px-5 pb-10" showsVerticalScrollIndicator={false}>
        {coupons.isLoading ? <ListSkeleton rows={3} /> : null}
        {list.map((coupon) => (
          <View
            key={coupon.id}
            className={cardClass({ padding: 'md' }, 'gap-2')}
            style={{ opacity: coupon.active ? 1 : 0.6 }}
          >
            <View className="flex-row items-center justify-between">
              <View className="flex-1">
                <View className="flex-row items-center gap-2">
                  <Text className="font-sora-semibold text-foreground">{coupon.code}</Text>
                  {!coupon.active ? (
                    <View
                      className="rounded-full px-2 py-0.5"
                      style={{ backgroundColor: alpha(c.mutedForeground, 0.16) }}
                    >
                      <Text variant="caption">{t('operator.archived')}</Text>
                    </View>
                  ) : null}
                </View>
                <Text variant="caption">
                  {coupon.discountType === 'percent'
                    ? t('operator.couponPercentOff', { value: coupon.discountValue })
                    : t('operator.couponFixedOff', {
                        value: (coupon.discountValue / 100).toFixed(2),
                      })}
                  {' · '}
                  {t('operator.couponCycles', { count: coupon.durationCycles })}
                </Text>
                <Text variant="caption">
                  {t('operator.couponRedemptions', {
                    count: coupon.redemptionsCount,
                    max: coupon.maxRedemptions ?? '∞',
                  })}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => void toggleActive(coupon, !coupon.active)}
                disabled={busy}
                hitSlop={8}
                className="h-9 w-9 items-center justify-center rounded-full border border-border"
              >
                {coupon.active ? (
                  <Archive size={15} color={c.mutedForeground} />
                ) : (
                  <RotateCcw size={15} color={c.mutedForeground} />
                )}
              </Pressable>
            </View>
          </View>
        ))}

        <Button
          variant="secondary"
          label={t('operator.addCoupon')}
          onPress={() => setForm(blankForm())}
        />

        {form ? (
          <View className={cardClass({ padding: 'md' }, 'gap-3')}>
            <Text variant="micro">{t('operator.newCoupon')}</Text>
            <TextInput
              value={form.code}
              onChangeText={(code) => setForm((f) => (f ? { ...f, code } : f))}
              placeholder={t('operator.couponCodePlaceholder')}
              placeholderTextColor={c.mutedForeground}
              autoCapitalize="characters"
              autoCorrect={false}
              className={cardClass({ padding: 'row' }, 'text-foreground')}
            />
            <View className="flex-row gap-2">
              {(['percent', 'fixed'] as const).map((type) => (
                <Pressable
                  key={type}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: form.discountType === type }}
                  onPress={() => setForm((f) => (f ? { ...f, discountType: type } : f))}
                  className="flex-1 items-center rounded-2xl border py-2.5"
                  style={{ borderColor: form.discountType === type ? c.accent : c.border }}
                >
                  <Text style={{ color: form.discountType === type ? c.accent : c.foreground }}>
                    {type === 'percent' ? t('operator.couponPercent') : t('operator.couponFixed')}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View className="flex-row gap-2">
              <TextInput
                value={form.discountValue}
                onChangeText={(v) => setForm((f) => (f ? { ...f, discountValue: v } : f))}
                placeholder={
                  form.discountType === 'percent'
                    ? t('operator.couponPercentPlaceholder')
                    : t('operator.couponCentsPlaceholder')
                }
                placeholderTextColor={c.mutedForeground}
                keyboardType="numeric"
                className={cardClass({ padding: 'row' }, 'flex-1 text-foreground')}
              />
              <TextInput
                value={form.durationCycles}
                onChangeText={(v) => setForm((f) => (f ? { ...f, durationCycles: v } : f))}
                placeholder={t('operator.couponCyclesPlaceholder')}
                placeholderTextColor={c.mutedForeground}
                keyboardType="numeric"
                className={cardClass({ padding: 'row' }, 'flex-1 text-foreground')}
              />
            </View>
            <View className="flex-row gap-2">
              <TextInput
                value={form.validDays}
                onChangeText={(v) => setForm((f) => (f ? { ...f, validDays: v } : f))}
                placeholder={t('operator.couponValidDaysPlaceholder')}
                placeholderTextColor={c.mutedForeground}
                keyboardType="numeric"
                className={cardClass({ padding: 'row' }, 'flex-1 text-foreground')}
              />
              <TextInput
                value={form.maxRedemptions}
                onChangeText={(v) => setForm((f) => (f ? { ...f, maxRedemptions: v } : f))}
                placeholder={t('operator.couponMaxRedemptionsPlaceholder')}
                placeholderTextColor={c.mutedForeground}
                keyboardType="numeric"
                className={cardClass({ padding: 'row' }, 'flex-1 text-foreground')}
              />
            </View>

            {paidPlans.length > 0 ? (
              <View className="gap-1.5">
                <Text variant="caption">{t('operator.couponPlansHint')}</Text>
                <View className="flex-row flex-wrap gap-2">
                  {paidPlans.map((plan) => {
                    const selected = form.planIds.has(plan.id);
                    return (
                      <Pressable
                        key={plan.id}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: selected }}
                        onPress={() => togglePlan(plan.id)}
                        className="rounded-full border px-3 py-1.5"
                        style={{ borderColor: selected ? c.accent : c.border }}
                      >
                        <Text style={{ color: selected ? c.accent : c.foreground }}>
                          {plan.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            <View className="flex-row gap-2">
              <View className="flex-1">
                <Button
                  variant="secondary"
                  label={t('common.cancel')}
                  onPress={() => setForm(null)}
                />
              </View>
              <View className="flex-1">
                <Button
                  label={busy ? t('common.saving') : t('common.save')}
                  onPress={() => void save()}
                  disabled={!form.code.trim() || !form.discountValue.trim() || busy}
                />
              </View>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
