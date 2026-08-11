import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Eye, EyeOff, Lock, Settings2, Sparkles, TrendingUp } from 'lucide-react-native';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { resolveTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { usePlan } from '@/features/billing/hooks/use-billing';
import { useModuleFlagsStore } from '@/features/module-flags/store/module-flags-store';
import {
  PRIVATE_MODULES,
  filterByRole,
  roleGateHidesAny,
} from '@/features/private/config/private-modules';
import { privateRecordCounts } from '@/features/private/services/private-repository';
import { usePrivateStore } from '@/features/private/store/private-store';
import { useProfileStore } from '@/features/profile/store/profile-store';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha, tintGradient } from '@/lib/color';

/**
 * The private space's home.
 *
 * Redirects out the moment the key disappears, which is how the auto-lock
 * actually takes effect for a screen that is already mounted — locking drops
 * the key, this notices, and the content is gone before it can be read.
 */
export default function PrivateHomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const { t } = useTranslation();

  const key = usePrivateStore((s) => s.key);
  const space = usePrivateStore((s) => s.space);
  const enabled = usePrivateStore((s) => s.enabledModules);
  const showAllModules = usePrivateStore((s) => s.showAllModules);
  const setShowAllModules = usePrivateStore((s) => s.setShowAllModules);
  const lock = usePrivateStore((s) => s.lock);
  const gender = useProfileStore((s) => s.gender);
  const moduleFlags = useModuleFlagsStore((s) => s.flags);
  const { isPlus } = usePlan();

  useEffect(() => {
    if (!key) router.replace('/private/unlock');
  }, [key, router]);

  const counts = useMemo(() => (key ? privateRecordCounts() : {}), [key]);

  if (!key) return null;

  // A `requiresRealSpace` module (shared albums) is visible to the server as
  // ordinary membership metadata, independent of which local key unlocked
  // this device — the decoy space must not surface it even though `key` is
  // non-null here too. See private-modules.ts's header for the full reasoning.
  const spaceEligible = PRIVATE_MODULES.filter(
    (m) =>
      enabled.includes(m.id) &&
      (!m.requiresRealSpace || space === 'real') &&
      moduleFlags[m.id]?.enabled !== false,
  );
  const roleFilteredIds = filterByRole(
    spaceEligible.map((m) => m.id),
    gender,
    showAllModules,
  );
  const modules = spaceEligible.filter((m) => roleFilteredIds.includes(m.id));
  const roleGateActive = roleGateHidesAny(
    spaceEligible.map((m) => m.id),
    gender,
  );

  // The one module suggested for this account's gender that isn't already the
  // universal Vault — the hero spot. Absent when there's nothing to spotlight
  // (unset gender, or every suggested module already turned off).
  const heroModule = modules.find(
    (m) => m.id !== 'vault' && gender !== null && m.suggestFor.includes(gender),
  );
  const heroTint = heroModule ? resolveTint(heroModule.tint, scheme) : null;

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-6 px-5"
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1 gap-1">
            <Text variant="heading">{t('private.spaceTitle')}</Text>
            <Text variant="muted">{t('private.spaceSubtitle')}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('private.lockNow')}
            onPress={() => {
              lock();
              router.replace('/(tabs)/hub');
            }}
            className="h-11 w-11 items-center justify-center rounded-full border border-border bg-surface"
          >
            <Lock size={19} color={theme.foreground} />
          </Pressable>
        </View>

        {/*
          The decoy space says so, and only from inside. Somebody who compelled
          the decoy PIN sees an ordinary, slightly empty private space; the
          owner needs to know which one they are looking at before they start
          adding real things to the wrong one.
        */}
        {space === 'decoy' ? (
          <View
            className="flex-row items-center gap-3 rounded-2xl px-4 py-3"
            style={{ backgroundColor: alpha(theme.accent, 0.12) }}
          >
            <EyeOff size={18} color={theme.accent} strokeWidth={1.9} />
            <Text variant="caption" className="flex-1">
              {t('private.decoyNotice')}
            </Text>
          </View>
        ) : null}

        {/*
          The role-personalized spotlight. Not a gate — everything it points to
          is already in `modules` below too, minus this one entry, so the hero
          is purely "here's the one built around you", never the only way in.
        */}
        {heroModule && heroTint ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(heroModule.route as never)}
            className="overflow-hidden rounded-3xl"
          >
            <LinearGradient
              colors={tintGradient(heroTint)}
              start={{ x: 0.1, y: 0.05 }}
              end={{ x: 0.95, y: 1 }}
              style={{ padding: 20, gap: 10 }}
            >
              <View className="flex-row items-center gap-2">
                <Sparkles size={15} color="#ffffff" strokeWidth={2} />
                <Text
                  variant="micro"
                  className="uppercase tracking-wide"
                  style={{ color: alpha('#ffffff', 0.85) }}
                >
                  {t('private.madeForYou')}
                </Text>
              </View>
              <View className="flex-row items-center gap-3.5">
                <View
                  className="h-14 w-14 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: alpha('#ffffff', 0.18) }}
                >
                  <heroModule.icon size={26} color="#ffffff" strokeWidth={1.9} />
                </View>
                <View className="flex-1">
                  <Text className="font-sora-bold text-lg text-white">
                    {t(heroModule.titleKey)}
                  </Text>
                  <Text style={{ color: alpha('#ffffff', 0.82) }} className="text-sm">
                    {t(heroModule.subtitleKey)}
                  </Text>
                </View>
              </View>
            </LinearGradient>
          </Pressable>
        ) : null}

        <View className="gap-3">
          {modules
            .filter((m) => m.id !== heroModule?.id)
            .map((module) => {
              const Icon = module.icon;
              const count = counts[module.id] ?? 0;
              const tint = resolveTint(module.tint, scheme);
              return (
                <Pressable
                  key={module.id}
                  accessibilityRole="button"
                  onPress={() => router.push(module.route as never)}
                  className={cardClass(
                    { padding: 'none' },
                    'flex-row items-center gap-3.5 px-4 py-4',
                  )}
                >
                  <View
                    className="h-12 w-12 items-center justify-center rounded-2xl"
                    style={{ backgroundColor: alpha(tint, 0.16) }}
                  >
                    <Icon size={22} color={tint} strokeWidth={1.9} />
                  </View>
                  <View className="flex-1">
                    <Text className="font-sora-medium text-foreground">{t(module.titleKey)}</Text>
                    <Text variant="caption">
                      {count > 0 ? t('private.itemCount', { count }) : t(module.subtitleKey)}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
        </View>

        {/*
          The compassionate escape hatch for the role gate above — see
          private-modules.ts's header. Only rendered when the gate is actually
          hiding something, so an account with nothing gated never sees a row
          about a filter that isn't doing anything to them.
        */}
        {roleGateActive ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowAllModules(!showAllModules)}
            className="flex-row items-center gap-3 rounded-2xl border border-dashed border-border px-4 py-3.5"
          >
            <Eye size={17} color={theme.mutedForeground} strokeWidth={1.9} />
            <Text variant="caption" className="flex-1">
              {showAllModules ? t('private.showingEveryModule') : t('private.showEveryModule')}
            </Text>
          </Pressable>
        ) : null}

        {/*
          Reachable by everyone — the content behind it is what's gated
          (insights.tsx), not the entry point itself. Hiding the row would
          mean a free account never learns the feature exists at all.
        */}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/private/insights')}
          className={cardClass({ padding: 'rowLg' }, 'flex-row items-center gap-3')}
        >
          <TrendingUp size={19} color={theme.mutedForeground} />
          <Text className="flex-1 font-sora-medium text-foreground">
            {t('private.insightsTitle')}
          </Text>
          {!isPlus ? (
            <View
              className="rounded-full px-2 py-0.5"
              style={{ backgroundColor: alpha(theme.accent, 0.14) }}
            >
              <Text
                variant="caption"
                className="font-sora-semibold"
                style={{ color: theme.accent }}
              >
                {t('billing.plusBadge')}
              </Text>
            </View>
          ) : null}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/private/settings')}
          className={cardClass({ padding: 'rowLg' }, 'flex-row items-center gap-3')}
        >
          <Settings2 size={19} color={theme.mutedForeground} />
          <Text className="flex-1 font-sora-medium text-foreground">
            {t('private.spaceSettings')}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
