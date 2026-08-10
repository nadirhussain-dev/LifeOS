import { useRouter } from 'expo-router';
import { EyeOff, Lock, Settings2 } from 'lucide-react-native';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { resolveTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { PRIVATE_MODULES } from '@/features/private/config/private-modules';
import { privateRecordCounts } from '@/features/private/services/private-repository';
import { usePrivateStore } from '@/features/private/store/private-store';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';

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
  const lock = usePrivateStore((s) => s.lock);

  useEffect(() => {
    if (!key) router.replace('/private/unlock');
  }, [key, router]);

  const counts = useMemo(() => (key ? privateRecordCounts() : {}), [key]);

  if (!key) return null;

  // A `requiresRealSpace` module (shared albums) is visible to the server as
  // ordinary membership metadata, independent of which local key unlocked
  // this device — the decoy space must not surface it even though `key` is
  // non-null here too. See private-modules.ts's header for the full reasoning.
  const modules = PRIVATE_MODULES.filter(
    (m) => enabled.includes(m.id) && (!m.requiresRealSpace || space === 'real'),
  );

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

        <View className="gap-3">
          {modules.map((module) => {
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
