import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Quote } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { WidgetCard } from '@/features/dashboard/components/widget-card';
import { useDailyQuote } from '@/features/dashboard/hooks/use-widget-data';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function DailyQuoteWidget() {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const { data, isLoading, error, refetch } = useDailyQuote();

  return (
    <WidgetCard
      error={error}
      onRetry={refetch}
      icon={Quote}
      title={t('dashboard.dailyQuote')}
      tint={moduleTint('journal', scheme)}
    >
      {isLoading || !data ? (
        <Skeleton className="h-10 w-full" />
      ) : (
        // A calm editorial moment: the quote itself is set in Literata (the
        // journal serif) so it reads as something to sit with, not chrome.
        <View className="gap-1.5">
          <Text className="font-journal-italic text-lg leading-7 text-foreground">
            &ldquo;{data.quote}&rdquo;
          </Text>
          <Text variant="caption">— {data.author}</Text>
        </View>
      )}
    </WidgetCard>
  );
}
