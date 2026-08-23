import { Archive, Pencil, RotateCcw } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { Input } from '@/components/ui/input';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import {
  formatPrice,
  periodI18nKey,
  type BillingPeriod,
  type StoragePlan,
} from '@/features/billing/config/plans';
import {
  useAdminSetPlanActiveMutation,
  useAdminUpsertPlanMutation,
  usePlans,
} from '@/features/billing/hooks/use-billing';
import { useTheme } from '@/hooks/use-theme';
import { alpha } from '@/lib/color';
import { toast } from '@/lib/toast-store';

// Mirrors both `billing_plans`' check constraint and `admin_upsert_plan`'s own
// validation (0073) — three copies of one list, and the RPC refuses anything
// this array offers that it has not been taught.
const PERIODS: BillingPeriod[] = ['free', 'month', 'quarter', 'year'];

type FormState = {
  id: string;
  name: string;
  storageMb: string;
  priceDollars: string;
  period: BillingPeriod;
  badge: string;
  sortOrder: string;
};

const blankForm = (sortOrder: number): FormState => ({
  id: '',
  name: '',
  storageMb: '',
  priceDollars: '',
  period: 'month',
  badge: '',
  sortOrder: String(sortOrder),
});

const formFor = (plan: StoragePlan): FormState => ({
  id: plan.id,
  name: plan.name,
  storageMb: String(Math.round(plan.storageBytes / (1024 * 1024))),
  priceDollars: (plan.priceCents / 100).toFixed(2),
  period: plan.period,
  badge: plan.badge ?? '',
  sortOrder: '0',
});

/**
 * Pricing — admin-tier (not owner-exclusive: 0018 defines `admin` as
 * "unrestricted", and day-to-day price changes are exactly that kind of
 * work, not roster-shaped). Every field an admin edits here writes through
 * `admin_upsert_plan` (0034); there is no direct table write from the
 * client, same discipline as every other operator-touched table in this
 * schema.
 */
export default function OperatorPricingScreen() {
  const { t } = useTranslation();
  const { c } = useTheme();

  const { data: plans = [] } = usePlans();
  const upsert = useAdminUpsertPlanMutation();
  const setActive = useAdminSetPlanActiveMutation();

  const [form, setForm] = useState<FormState | null>(null);
  const editingExisting = form ? plans.some((p) => p.id === form.id) : false;

  const save = () => {
    if (!form || !form.id.trim() || !form.name.trim()) return;
    const storageBytes = Math.max(0, Math.round(Number(form.storageMb) * 1024 * 1024));
    const priceCents = Math.max(0, Math.round(Number(form.priceDollars) * 100));
    if (!Number.isFinite(storageBytes) || !Number.isFinite(priceCents)) return;

    upsert.mutate(
      {
        id: form.id.trim(),
        name: form.name.trim(),
        storageBytes,
        priceCents,
        currency: 'usd',
        period: form.period,
        badge: form.badge.trim() || null,
        sortOrder: Number(form.sortOrder) || 0,
      },
      {
        onSuccess: () => {
          toast.success(t('operator.planSaved'));
          setForm(null);
        },
        onError: () => toast.error(t('errors.unknown')),
      },
    );
  };

  const toggleActive = (plan: StoragePlan, active: boolean) =>
    setActive.mutate({ id: plan.id, active }, { onError: () => toast.error(t('errors.unknown')) });

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        eyebrow={t('operator.eyebrow')}
        title={t('billing.plans')}
        subtitle={t('operator.pricingSubtitle')}
        tint={c.error}
      />

      <ScrollView contentContainerClassName="gap-3 px-5 pb-10" showsVerticalScrollIndicator={false}>
        {plans.map((plan) => (
          <View
            key={plan.id}
            className={cardClass({ padding: 'md' }, 'gap-2')}
            style={{ opacity: plan.active ? 1 : 0.6 }}
          >
            <View className="flex-row items-center justify-between">
              <View className="flex-1">
                <View className="flex-row items-center gap-2">
                  <Text className="font-sora-semibold text-foreground">{plan.name}</Text>
                  {!plan.active ? (
                    <View
                      className="rounded-full px-2 py-0.5"
                      style={{ backgroundColor: alpha(c.mutedForeground, 0.16) }}
                    >
                      <Text variant="caption">{t('operator.archived')}</Text>
                    </View>
                  ) : null}
                </View>
                <Text variant="caption">
                  {(plan.storageBytes / (1024 * 1024 * 1024)).toFixed(2)} GB ·{' '}
                  {formatPrice(plan.priceCents, plan.currency)} {t(periodI18nKey(plan.period))}
                </Text>
              </View>
              <View className="flex-row gap-2">
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setForm(formFor(plan))}
                  hitSlop={8}
                  className="h-9 w-9 items-center justify-center rounded-full"
                  style={{ backgroundColor: alpha(c.accent, 0.14) }}
                >
                  <Pencil size={15} color={c.accent} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => toggleActive(plan, !plan.active)}
                  hitSlop={8}
                  className="h-9 w-9 items-center justify-center rounded-full border border-border"
                >
                  {plan.active ? (
                    <Archive size={15} color={c.mutedForeground} />
                  ) : (
                    <RotateCcw size={15} color={c.mutedForeground} />
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        ))}

        <Button
          variant="secondary"
          label={t('operator.addPlan')}
          onPress={() => setForm(blankForm(plans.length))}
        />

        {/* Archived plans stay editable/restorable — an admin managing
            pricing has to be able to find what they hid, same reasoning as
            RLS letting `is_admin()` see them at all (0034). */}
        <Text variant="caption" className="px-1">
          {t('operator.archivedPlansNote')}
        </Text>

        {form ? (
          <View className={cardClass({ padding: 'md' }, 'gap-3')}>
            <Text variant="micro">
              {editingExisting ? t('operator.editPlan') : t('operator.newPlan')}
            </Text>
            {!editingExisting ? (
              <Input
                value={form.id}
                onChangeText={(id) => setForm((f) => (f ? { ...f, id } : f))}
                placeholder={t('operator.planIdPlaceholder')}
                autoCapitalize="none"
                autoCorrect={false}
              />
            ) : null}
            <Input
              value={form.name}
              onChangeText={(name) => setForm((f) => (f ? { ...f, name } : f))}
              placeholder={t('operator.planNamePlaceholder')}
            />
            <View className="flex-row gap-2">
              <Input
                value={form.storageMb}
                onChangeText={(v) => setForm((f) => (f ? { ...f, storageMb: v } : f))}
                placeholder={t('operator.storageMbPlaceholder')}
                keyboardType="numeric"
                containerClassName="flex-1"
              />
              <Input
                value={form.priceDollars}
                onChangeText={(v) => setForm((f) => (f ? { ...f, priceDollars: v } : f))}
                placeholder={t('operator.priceDollarsPlaceholder')}
                keyboardType="decimal-pad"
                containerClassName="flex-1"
              />
            </View>
            <View className="flex-row gap-2">
              {PERIODS.map((period) => (
                <Pressable
                  key={period}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: form.period === period }}
                  onPress={() => setForm((f) => (f ? { ...f, period } : f))}
                  className="flex-1 items-center rounded-2xl border py-2.5"
                  style={{ borderColor: form.period === period ? c.accent : c.border }}
                >
                  <Text style={{ color: form.period === period ? c.accent : c.foreground }}>
                    {t(periodI18nKey(period))}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Input
              value={form.badge}
              onChangeText={(badge) => setForm((f) => (f ? { ...f, badge } : f))}
              placeholder={t('operator.badgePlaceholder')}
            />
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
                  label={upsert.isPending ? t('common.saving') : t('common.save')}
                  onPress={save}
                  disabled={!form.id.trim() || !form.name.trim() || upsert.isPending}
                />
              </View>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
