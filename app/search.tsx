import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { Search, X } from 'lucide-react-native';
import { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, Pressable, View } from 'react-native';

import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { SheetHeader } from '@/components/ui/sheet-header';
import { Text } from '@/components/ui/text';
import { moduleTint, moduleTintText } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { CATEGORY_META } from '@/features/notifications/types/notification.types';
import { searchEverything } from '@/features/search/services/search-sources';
import type { SearchResult, SearchResultKind } from '@/features/search/services/global-search';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';

/**
 * One search across every module.
 *
 * Twelve modules and, until now, no way to look through more than one at a
 * time — so anything you wrote down was findable only if you already remembered
 * where you put it, which is the memory the app exists to do for you.
 *
 * Results are ranked by how well they match, not by which table they came from
 * (see global-search.ts), and each one carries its module's tint so the answer
 * to "where was that?" is visible before you tap.
 */
export default function SearchScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  // Keeps typing responsive: the query drives the input immediately while the
  // (synchronous, all-module) search runs against a slightly stale value.
  const deferred = useDeferredValue(query);
  const results = useMemo(() => searchEverything(deferred), [deferred]);

  const open = (result: SearchResult) => {
    Keyboard.dismiss();
    router.push({ pathname: result.route as never, params: (result.params ?? {}) as never });
  };

  const tooShort = query.trim().length > 0 && query.trim().length < 2;

  return (
    <View className="flex-1 bg-background">
      <SheetHeader title={t('search.title')} />

      <View className="px-5 pb-2 pt-1">
        <View className="flex-row items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5">
          <Search size={16} color={colors[scheme].mutedForeground} />
          <Input
            surface="bare"
            value={query}
            onChangeText={setQuery}
            accessibilityLabel={t('search.placeholder')}
            placeholder={t('search.placeholder')}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            className="flex-1 text-foreground"
          />
          {query.length > 0 ? (
            <Pressable
              onPress={() => setQuery('')}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('common.clear')}
            >
              <X size={16} color={colors[scheme].mutedForeground} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {query.trim().length === 0 || tooShort ? (
        <EmptyState
          icon={Search}
          title={t('search.promptTitle')}
          description={t('search.promptBody')}
          tint={moduleTint('habit', scheme)}
        />
      ) : results.length === 0 ? (
        <EmptyState
          icon={Search}
          title={t('search.noResultsTitle', { query: query.trim() })}
          description={t('search.noResultsBody')}
          tint={moduleTint('habit', scheme)}
        />
      ) : (
        <>
          <Text variant="caption" className="px-5 pb-1 pt-1">
            {t('search.resultCount', { count: results.length })}
          </Text>
          <FlashList
            data={results}
            keyExtractor={(item) => `${item.kind}:${item.id}`}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 40 }}
            renderItem={({ item }) => <ResultRow result={item} onPress={() => open(item)} />}
          />
        </>
      )}
    </View>
  );
}

/** Result kind → the notification category whose icon best describes it. Reusing
 *  that table keeps one icon per concept across the whole app. */
const KIND_ICON: Record<SearchResultKind, keyof typeof CATEGORY_META> = {
  task: 'tasks',
  note: 'notes',
  habit: 'habits',
  goal: 'goals',
  journal: 'journal',
  transaction: 'budget',
  debt: 'budget',
  subject: 'study',
  song: 'split',
  playlist: 'split',
  album: 'split',
  group: 'split',
};

function ResultRow({ result, onPress }: { result: SearchResult; onPress: () => void }) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const tint = moduleTint(result.module, scheme);
  const Icon = CATEGORY_META[KIND_ICON[result.kind]].icon;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${t(`search.kind.${result.kind}`)}: ${result.title}`}
      className="flex-row items-center gap-3 px-5 py-3 active:opacity-70"
    >
      <View
        className="h-10 w-10 items-center justify-center rounded-xl"
        style={{ backgroundColor: alpha(tint, 0.12) }}
      >
        <Icon size={18} color={tint} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="font-sora-medium text-foreground" numberOfLines={1}>
          {result.title}
        </Text>
        {result.subtitle ? (
          <Text variant="caption" numberOfLines={1}>
            {result.subtitle}
          </Text>
        ) : null}
      </View>
      {/* Which module it lives in — the answer to "where was that?", legible
          rather than merely tinted. */}
      <Text
        variant="caption"
        className="font-sora-medium"
        style={{ color: moduleTintText(result.module, scheme) }}
      >
        {t(`search.kind.${result.kind}`)}
      </Text>
    </Pressable>
  );
}
