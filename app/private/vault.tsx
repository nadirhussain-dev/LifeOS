import { Image } from 'expo-image';
import { Camera, ImagePlus, Trash2 } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dimensions, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { moduleTints, resolveTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { PrivateScreen } from '@/features/private/components/private-screen';
import { privateModule } from '@/features/private/config/private-modules';
import { MAX_VAULT_MB, pickIntoVault } from '@/features/private/services/vault-files';
import {
  addVaultItems,
  listVaultItems,
  removeVaultItem,
  vaultItemDataUri,
  type VaultItem,
} from '@/features/private/services/vault-items';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';
import { confirm } from '@/lib/dialog-store';
import { toast } from '@/lib/toast-store';

const TINT = privateModule('vault')?.tint ?? moduleTints.vault;
const GAP = 8;

/**
 * The vault grid.
 *
 * Every thumbnail is a decrypt. That is the cost of the guarantee — there is no
 * plaintext preview cached anywhere, so nothing survives a lock and nothing is
 * left behind for the OS gallery to find. The grid decrypts lazily and holds
 * the results only for the life of this screen.
 */
export default function VaultScreen() {
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const tint = resolveTint(TINT, scheme);
  const { t } = useTranslation();

  // See cycle.tsx: explicit reload rather than a counter dependency.
  const [items, setItems] = useState(listVaultItems);
  const reload = useCallback(() => setItems(listVaultItems()), []);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<VaultItem | null>(null);

  const columns = 3;
  const size = (Dimensions.get('window').width - 40 - GAP * (columns - 1)) / columns;

  const add = useCallback(
    async (source: 'library' | 'camera') => {
      setBusy(true);
      try {
        const { items: picked, rejectedOversize } = await pickIntoVault(source);
        if (picked.length > 0) {
          addVaultItems(picked);
          reload();
        }
        if (rejectedOversize > 0) {
          toast.error(t('private.tooLargeBody', { count: rejectedOversize, mb: MAX_VAULT_MB }));
        }
      } finally {
        setBusy(false);
      }
    },
    [t, reload],
  );

  const confirmDelete = (item: VaultItem) =>
    void confirm({
      title: t('private.deleteItem'),
      message: t('private.deleteItemBody'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      removeVaultItem(item);
      setSelected(null);
      reload();
    });

  return (
    <PrivateScreen
      title={t('private.vaultTitle')}
      subtitle={t('private.itemCount', { count: items.length })}
      tint={tint}
      footer={
        <View className="flex-row gap-2">
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void add('library')}
            className="flex-1 flex-row items-center justify-center gap-2 rounded-2xl py-4"
            style={{ backgroundColor: alpha(tint, 0.16), opacity: busy ? 0.5 : 1 }}
          >
            <ImagePlus size={19} color={tint} strokeWidth={1.9} />
            <Text className="font-sora-medium" style={{ color: tint }}>
              {t('private.addFromLibrary')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('private.takePhoto')}
            disabled={busy}
            onPress={() => void add('camera')}
            className="h-[52px] w-[52px] items-center justify-center rounded-2xl"
            style={{ backgroundColor: alpha(tint, 0.16), opacity: busy ? 0.5 : 1 }}
          >
            <Camera size={20} color={tint} strokeWidth={1.9} />
          </Pressable>
        </View>
      }
    >
      {items.length === 0 ? (
        <View className="items-center gap-2 py-16">
          <Text variant="subheading">{t('private.vaultEmptyTitle')}</Text>
          <Text variant="muted" className="text-center">
            {t('private.vaultEmptyBody')}
          </Text>
        </View>
      ) : (
        <View className="flex-row flex-wrap" style={{ gap: GAP }}>
          {items.map((item) => (
            <VaultThumbnail
              key={item.id}
              item={item}
              size={size}
              onPress={() => setSelected(item)}
              onLongPress={() => confirmDelete(item)}
            />
          ))}
        </View>
      )}

      {/* Full-size viewer. Also decrypted in memory, and dropped on close. */}
      {selected ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setSelected(null)}
          className="absolute inset-0 items-center justify-center px-4"
          style={{ backgroundColor: alpha(theme.background, 0.97) }}
        >
          <VaultFullImage item={selected} />
          <Pressable
            accessibilityRole="button"
            onPress={() => confirmDelete(selected)}
            className="mt-5 flex-row items-center gap-2 rounded-full border px-4 py-2.5"
            style={{ borderColor: alpha(theme.destructive, 0.5) }}
          >
            <Trash2 size={17} color={theme.destructive} />
            <Text style={{ color: theme.destructive }}>{t('common.delete')}</Text>
          </Pressable>
        </Pressable>
      ) : null}
    </PrivateScreen>
  );
}

function VaultThumbnail({
  item,
  size,
  onPress,
  onLongPress,
}: {
  item: VaultItem;
  size: number;
  onPress: () => void;
  onLongPress: () => void;
}) {
  // Decrypted once per mount and held only in this component's memory.
  const uri = useMemo(() => vaultItemDataUri(item), [item]);

  return (
    <Pressable
      accessibilityRole="imagebutton"
      onPress={onPress}
      onLongPress={onLongPress}
      style={{ width: size, height: size }}
      className="overflow-hidden rounded-xl bg-surface"
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          // No disk cache: a cached copy of a vault image is a plaintext copy
          // of a vault image, sitting outside the vault.
          cachePolicy="none"
        />
      ) : null}
    </Pressable>
  );
}

function VaultFullImage({ item }: { item: VaultItem }) {
  const uri = useMemo(() => vaultItemDataUri(item), [item]);
  if (!uri) return null;
  return (
    <Image
      source={{ uri }}
      style={{ width: '100%', height: '75%' }}
      contentFit="contain"
      cachePolicy="none"
    />
  );
}
