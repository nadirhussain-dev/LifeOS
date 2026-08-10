import * as Clipboard from 'expo-clipboard';
import { Copy, KeyRound, Share2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { PrivateScreen } from '@/features/private/components/private-screen';
import { createTransfer, type TransferBundle } from '@/features/private/services/key-transfer';
import { usePrivateStore } from '@/features/private/store/private-store';
import { useTheme } from '@/hooks/use-theme';
import { Text } from '@/components/ui/text';
import { toast } from '@/lib/toast-store';

/**
 * Sending this vault to another device the same person owns.
 *
 * Private modules have always synced end-to-end — the payload column has been
 * ciphertext since the vault was built. What has never worked is opening it
 * anywhere else, because the key is wrapped under a salt that lives in this
 * device's keystore. This is the missing half.
 *
 * The screen exists to make one thing obvious: **the code and the payload must
 * travel separately.** If both go in the same message, the scheme is a plaintext
 * key in a chat log. The layout separates them and the copy says so, because
 * this is the step where a user's convenience instinct is exactly wrong.
 */
export default function VaultTransferScreen() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const key = usePrivateStore((s) => s.key);
  const space = usePrivateStore((s) => s.space);

  const [bundle, setBundle] = useState<TransferBundle | null>(null);

  useEffect(() => {
    // Only ever the real space. Transferring a decoy would move a key that
    // opens nothing anybody wants, and doing it from inside the decoy would
    // reveal that the decoy is a decoy.
    if (!key || space !== 'real') return;
    void createTransfer(key).then(setBundle);
  }, [key, space]);

  if (!key || space !== 'real') {
    return (
      <PrivateScreen title={t('transfer.title')} tint={c.accent}>
        <Text variant="muted">{t('transfer.unavailable')}</Text>
      </PrivateScreen>
    );
  }

  return (
    <PrivateScreen title={t('transfer.title')} tint={c.accent}>
      <ScrollView contentContainerClassName="gap-6 pb-10" showsVerticalScrollIndicator={false}>
        <Text variant="muted">{t('transfer.intro')}</Text>

        {/* Step one: the code. Shown large and on its own, because it is meant
            to be read aloud rather than copied. */}
        <View className={cardClass({ padding: 'md' }, 'gap-2')}>
          <View className="flex-row items-center gap-2">
            <KeyRound size={16} color={c.accent} />
            <Text variant="micro">{t('transfer.stepCode')}</Text>
          </View>
          <Text
            className="font-sora-bold text-foreground"
            style={{ fontSize: 20, letterSpacing: 2 }}
            selectable
          >
            {bundle?.code ?? '…'}
          </Text>
          <Text variant="caption">{t('transfer.codeHint')}</Text>
        </View>

        {/* Step two: the payload. Copyable, shareable, and worthless alone. */}
        <View className={cardClass({ padding: 'md' }, 'gap-3')}>
          <View className="flex-row items-center gap-2">
            <Share2 size={16} color={c.accent} />
            <Text variant="micro">{t('transfer.stepPayload')}</Text>
          </View>
          <Text variant="caption">{t('transfer.payloadHint')}</Text>

          {/* One action, deliberately. `Sharing.shareAsync` takes a file URI,
              not a string, so a "share" button here would mean writing the
              wrapped key to a file on disk — a worse place for it than the
              clipboard, and one it would outlive the transfer in. Copy, then
              paste wherever the user likes. */}
          <Pressable
            accessibilityRole="button"
            disabled={!bundle}
            onPress={() => {
              if (!bundle) return;
              void Clipboard.setStringAsync(bundle.payload).then(() =>
                toast.success(t('transfer.copied')),
              );
            }}
            className="flex-row items-center justify-center gap-2 rounded-full border py-3"
            style={{ borderColor: c.border, opacity: bundle ? 1 : 0.5 }}
          >
            <Copy size={15} color={c.foreground} />
            <Text className="font-sora-medium" style={{ color: c.foreground }}>
              {t('transfer.copyPayload')}
            </Text>
          </Pressable>
        </View>

        {/* The warning that makes the whole design work, stated where the
            temptation is rather than in a policy nobody opens. */}
        <View
          className="rounded-2xl border p-4"
          style={{ borderColor: c.warning, backgroundColor: `${c.warning}14` }}
        >
          <Text className="font-sora-semibold" style={{ color: c.foreground }}>
            {t('transfer.warnTitle')}
          </Text>
          <Text variant="caption" className="mt-1">
            {t('transfer.warnBody')}
          </Text>
        </View>

        <Text variant="caption">{t('transfer.expiryNote')}</Text>

        <Button
          variant="secondary"
          size="lg"
          label={t('transfer.newCode')}
          onPress={() => void createTransfer(key).then(setBundle)}
        />
      </ScrollView>
    </PrivateScreen>
  );
}
