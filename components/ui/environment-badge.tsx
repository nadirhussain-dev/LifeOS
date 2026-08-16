import { FlaskConical } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { appEnv, isProductionEnv, supabaseProjectRef } from '@/lib/env';

/**
 * "This is not the real app."
 *
 * A staging build already announces itself outside the app — it installs as
 * `com.daykeep.app.staging`, named "Daykeep (Staging)", with its own icon
 * (scripts/build-env.js). That covers picking the wrong icon off a home screen.
 * It does not cover the screenshot in a bug report, or the tester who signs up,
 * finds their data missing tomorrow, and files it against production.
 *
 * So the environment is also stated inside the app, at the two places where
 * being wrong about it has a cost: the sign-in screen, because that is where an
 * account gets created in whichever database this build is pointed at, and the
 * sync screen, because that is where somebody goes to ask why their data is not
 * where they expected.
 *
 * Both render nothing in production. `isProductionEnv` is false whenever the
 * environment is unknown, so the failure direction is a badge on a build that
 * did not need one — never a missing badge on a build that did.
 */

/** Environment name in the user's language. Falls back to the raw value so an
 * unrecognised environment still shows *something* rather than an empty pill. */
function useEnvironmentLabel(): string {
  const { t } = useTranslation();
  if (appEnv === 'staging') return t('env.staging');
  if (appEnv === 'development') return t('env.development');
  return appEnv;
}

/**
 * The compact form: an inline pill, for screens with no room to explain.
 */
export function EnvironmentPill({ className }: { className?: string }) {
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const label = useEnvironmentLabel();

  if (isProductionEnv) return null;

  return (
    <View
      className={`flex-row items-center gap-1.5 self-center rounded-full px-3 py-1 ${className ?? ''}`}
      style={{ backgroundColor: `${theme.warning}22`, borderColor: theme.warning, borderWidth: 1 }}
    >
      <FlaskConical size={12} color={theme.warning} />
      <Text
        variant="caption"
        className="font-sora-semibold uppercase tracking-wide"
        style={{ color: theme.warning }}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * The explained form: what this build is, and which Supabase project it is
 * talking to.
 *
 * The project ref is shown because it is the only thing that distinguishes two
 * correctly-working builds from each other on a phone. It is public — half of
 * every request the app makes — so there is nothing to protect here.
 */
export function EnvironmentNotice({ className }: { className?: string }) {
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const { t } = useTranslation();
  const label = useEnvironmentLabel();

  if (isProductionEnv) return null;

  return (
    <View
      className={cardClass({ padding: 'md' }, `gap-2 ${className ?? ''}`)}
      style={{ borderColor: theme.warning }}
    >
      <View className="flex-row items-center gap-2">
        <FlaskConical size={16} color={theme.warning} />
        <Text className="font-sora-semibold" style={{ color: theme.warning }}>
          {label}
        </Text>
      </View>
      <Text variant="caption">{t('env.body')}</Text>
      {supabaseProjectRef && (
        <View className="flex-row items-center justify-between gap-3 pt-1">
          <Text variant="caption" className="font-sora-medium">
            {t('env.project')}
          </Text>
          <Text variant="caption" numberOfLines={1}>
            {supabaseProjectRef}
          </Text>
        </View>
      )}
    </View>
  );
}
