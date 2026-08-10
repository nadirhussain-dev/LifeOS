import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Switch, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { HUB_SECTIONS } from '@/features/hub/config/modules';
import { PinPad } from '@/features/private/components/pin-pad';
import { PrivateScreen } from '@/features/private/components/private-screen';
import { PRIVATE_MODULES } from '@/features/private/config/private-modules';
import {
  deleteAllPrivateRecords,
  deleteModuleRecords,
} from '@/features/private/services/private-repository';
import { deleteAllVaultFiles } from '@/features/private/services/vault-files';
import {
  MIN_PIN_LENGTH,
  changePin,
  destroyVaultKeys,
  hasDecoy,
  removeDecoy,
  setUpDecoy,
} from '@/features/private/services/vault-keys';
import { usePrivateStore } from '@/features/private/store/private-store';
import { resyncAllReminders } from '@/features/notifications/services/reminder-scheduler';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { confirm } from '@/lib/dialog-store';

/** Ordinary Hub modules that may be moved behind the vault. Settings is
 * excluded by `canBePrivate` — hiding it would take away the screen holding
 * the switch that puts it back. */
const MOVABLE_MODULES = HUB_SECTIONS.flatMap((section) => section.modules).filter(
  (module) => module.canBePrivate,
);

type Mode = 'menu' | 'change-current' | 'change-next' | 'decoy';

export default function PrivateSettingsScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const { t } = useTranslation();

  const space = usePrivateStore((s) => s.space);
  const enabled = usePrivateStore((s) => s.enabledModules);
  const toggleModule = usePrivateStore((s) => s.toggleModule);
  const privatised = usePrivateStore((s) => s.privatised);
  const togglePrivatised = usePrivateStore((s) => s.togglePrivatised);
  const hiddenFromSettings = usePrivateStore((s) => s.hiddenFromSettings);
  const setHiddenFromSettings = usePrivateStore((s) => s.setHiddenFromSettings);
  const reset = usePrivateStore((s) => s.reset);

  const [mode, setMode] = useState<Mode>('menu');
  const [currentPin, setCurrentPin] = useState('');
  const [nextPin, setNextPin] = useState('');
  const [decoyExists, setDecoyExists] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void hasDecoy().then(setDecoyExists);
  }, []);

  const confirmToggle = (id: (typeof PRIVATE_MODULES)[number]['id']) => {
    if (!enabled.includes(id)) {
      toggleModule(id);
      return;
    }
    // Turning a module off deletes what is in it — say so before, not after.
    void confirm({
      title: t('private.turnOffTitle'),
      message: t('private.turnOffBody'),
      confirmLabel: t('private.turnOffConfirm'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      deleteModuleRecords(id);
      toggleModule(id);
    });
  };

  /**
   * Turning this on is the one setting in the app that can make the app appear
   * to have lost a feature, so it is gated behind a dialog that states the
   * replacement gesture rather than a subtitle nobody reads. Turning it back off
   * needs no confirmation — restoring a visible row cannot lock anyone out.
   */
  const toggleHidden = (next: boolean) => {
    if (!next) {
      setHiddenFromSettings(false);
      return;
    }
    void confirm({
      title: t('private.hideRowTitle'),
      message: t('private.hideRowBody'),
      confirmLabel: t('private.hideRowConfirm'),
      cancelLabel: t('common.cancel'),
    }).then((ok) => {
      if (ok) setHiddenFromSettings(true);
    });
  };

  const destroy = () =>
    void confirm({
      title: t('private.destroyTitle'),
      message: t('private.destroyBody'),
      confirmLabel: t('private.destroyConfirm'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      // Second confirmation: this is genuinely unrecoverable, and one
      // mis-tap should not be enough to trigger it.
      void confirm({
        title: t('private.destroyAgainTitle'),
        message: t('private.destroyAgainBody'),
        confirmLabel: t('private.destroyConfirm'),
        cancelLabel: t('common.cancel'),
        destructive: true,
      }).then(async (ok) => {
        if (!ok) return;
        void (async () => {
          deleteAllPrivateRecords();
          deleteAllVaultFiles();
          await destroyVaultKeys();
          reset();
          router.replace('/(tabs)/hub');
        })();
      });
    });

  if (mode !== 'menu') {
    const isChange = mode === 'change-current' || mode === 'change-next';
    const value = mode === 'change-current' ? currentPin : nextPin;
    const setValue = mode === 'change-current' ? setCurrentPin : setNextPin;

    const submit = async () => {
      setBusy(true);
      setError(null);
      if (mode === 'change-current') {
        setBusy(false);
        setMode('change-next');
        return;
      }
      if (mode === 'change-next') {
        const ok = await changePin(currentPin, nextPin);
        setBusy(false);
        if (!ok) {
          setError(t('private.wrongPin'));
          setCurrentPin('');
          setNextPin('');
          setMode('change-current');
          return;
        }
        setDecoyExists(false);
        setCurrentPin('');
        setNextPin('');
        setMode('menu');
        return;
      }
      // Decoy setup.
      await setUpDecoy(nextPin);
      setDecoyExists(true);
      setBusy(false);
      setNextPin('');
      setMode('menu');
    };

    return (
      <PrivateScreen
        title={isChange ? t('private.changePin') : t('private.setDecoy')}
        tint={theme.accent}
        footer={
          <View className="gap-2">
            <Button
              variant="accent"
              size="lg"
              label={t('common.continue')}
              disabled={busy || value.length < MIN_PIN_LENGTH}
              onPress={() => void submit()}
            />
            <Button
              variant="ghost"
              size="lg"
              label={t('common.cancel')}
              onPress={() => {
                setCurrentPin('');
                setNextPin('');
                setError(null);
                setMode('menu');
              }}
            />
          </View>
        }
      >
        <View className="items-center gap-6 pt-6">
          <Text variant="muted" className="text-center">
            {error ??
              (mode === 'change-current'
                ? t('private.enterCurrentPin')
                : mode === 'change-next'
                  ? t('private.enterNewPin')
                  : t('private.decoyHint'))}
          </Text>
          <PinPad value={value} onChange={setValue} disabled={busy} dotCount={MIN_PIN_LENGTH} />
        </View>
      </PrivateScreen>
    );
  }

  return (
    <PrivateScreen title={t('private.spaceSettings')} tint={theme.accent}>
      <View className="gap-3">
        <Text variant="micro">{t('private.whatIsInHere')}</Text>
        <View className={cardClass({ padding: 'none' }, 'px-4')}>
          {PRIVATE_MODULES.map((module, index) => (
            <View
              key={module.id}
              className={
                index === 0
                  ? 'flex-row items-center gap-3 py-3.5'
                  : 'flex-row items-center gap-3 border-t border-border py-3.5'
              }
            >
              <View className="flex-1">
                <Text className="font-sora-medium text-foreground">{t(module.titleKey)}</Text>
                <Text variant="caption">{t(module.subtitleKey)}</Text>
              </View>
              <Switch
                value={enabled.includes(module.id)}
                onValueChange={() => confirmToggle(module.id)}
                trackColor={{ true: theme.accent, false: theme.border }}
              />
            </View>
          ))}
        </View>
      </View>

      <View className="gap-3">
        <Text variant="micro">{t('private.moveModules')}</Text>
        <View className={cardClass({ padding: 'none' }, 'px-4')}>
          {MOVABLE_MODULES.map((module, index) => (
            <View
              key={module.id}
              className={
                index === 0
                  ? 'flex-row items-center gap-3 py-3.5'
                  : 'flex-row items-center gap-3 border-t border-border py-3.5'
              }
            >
              <View className="flex-1">
                <Text className="font-sora-medium text-foreground">{t(module.titleKey)}</Text>
                <Text variant="caption">{t(module.subtitleKey)}</Text>
              </View>
              <Switch
                value={privatised.includes(module.id)}
                onValueChange={() => {
                  togglePrivatised(module.id);
                  // Reminders already sitting in the OS queue carry the text
                  // they were scheduled with, and the OS will not let us edit
                  // it. Making a module private has to rebuild them or the
                  // next fortnight of notifications keeps naming its contents
                  // on the lock screen — the switch would appear to work and
                  // quietly not. The rebuild also restores the real text when
                  // the switch goes back the other way.
                  void resyncAllReminders();
                }}
                trackColor={{ true: theme.accent, false: theme.border }}
              />
            </View>
          ))}
        </View>
        {/*
          The honest caveat, stated where the switch is rather than buried in a
          policy. Moving a module here hides it and gates it behind the PIN —
          it does not re-encrypt rows that already live in ordinary tables, and
          the word "private" invites people to assume it does.
        */}
        <Text variant="caption" className="px-1">
          {t('private.moveModulesNote')}
        </Text>
      </View>

      {/*
        Only offered from the real space. Inside the decoy, a "set up a decoy"
        row would be a neon sign saying this is the decoy — which is precisely
        what somebody standing over your shoulder is looking for.
      */}
      {space === 'real' ? (
        <View className="gap-3">
          <Text variant="micro">{t('private.security')}</Text>
          <View className="gap-2">
            {/*
              Offered only from the real space, for the same reason the decoy row
              is: inside the decoy, a switch that hides the way in would be one
              more thing that behaves differently there.
            */}
            <View className={cardClass({ padding: 'rowLg' }, 'flex-row items-center gap-3')}>
              <View className="flex-1">
                <Text className="font-sora-medium text-foreground">{t('private.hideRow')}</Text>
                <Text variant="caption">{t('private.hideRowHint')}</Text>
              </View>
              <Switch
                value={hiddenFromSettings}
                onValueChange={toggleHidden}
                trackColor={{ true: theme.accent, false: theme.border }}
              />
            </View>

            {/*
              The other half of end-to-end sync. Private rows have always
              travelled as ciphertext; without moving the key, a second device
              receives them and can only ever show noise.
            */}
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/private/transfer')}
              className={cardClass({ padding: 'rowLg' })}
            >
              <Text className="font-sora-medium text-foreground">{t('transfer.entry')}</Text>
              <Text variant="caption">{t('transfer.entryHint')}</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => setMode('change-current')}
              className={cardClass({ padding: 'rowLg' })}
            >
              <Text className="font-sora-medium text-foreground">{t('private.changePin')}</Text>
              <Text variant="caption">{t('private.changePinHint')}</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (decoyExists) {
                  void confirm({
                    title: t('private.removeDecoyTitle'),
                    message: t('private.removeDecoyBody'),
                    confirmLabel: t('common.delete'),
                    cancelLabel: t('common.cancel'),
                    destructive: true,
                  }).then(async (ok) => {
                    if (!ok) return;
                    void removeDecoy().then(() => setDecoyExists(false));
                  });
                } else {
                  setMode('decoy');
                }
              }}
              className={cardClass({ padding: 'rowLg' })}
            >
              <Text className="font-sora-medium text-foreground">
                {decoyExists ? t('private.removeDecoy') : t('private.setDecoy')}
              </Text>
              <Text variant="caption">{t('private.decoyExplainer')}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View className="gap-3">
        <Text variant="micro">{t('private.dangerZone')}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={destroy}
          className="rounded-2xl border px-4 py-3.5"
          style={{ borderColor: theme.destructive }}
        >
          <Text className="font-sora-medium" style={{ color: theme.destructive }}>
            {t('private.destroySpace')}
          </Text>
          <Text variant="caption">{t('private.destroyHint')}</Text>
        </Pressable>
      </View>
    </PrivateScreen>
  );
}
