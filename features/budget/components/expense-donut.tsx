import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { DonutChart } from '@/components/ui/donut-chart';
import { Text } from '@/components/ui/text';
import { MoneyText } from '@/features/budget/components/money-text';
import type { CategorySlice } from '@/features/budget/types/budget.types';

type Props = {
  categories: CategorySlice[];
  totalCents: number;
  currency: string;
};

/** Expense breakdown donut plus a two-column legend. Top 6 categories get
 * their own slice; the rest fold into a neutral "Other" wedge so the ring never
 * fragments into hairline slivers. */
export function ExpenseDonut({ categories, totalCents, currency }: Props) {
  const { t } = useTranslation();
  const top = categories.slice(0, 6);
  const restCents = categories.slice(6).reduce((sum, c) => sum + c.amountCents, 0);
  const slices = [
    ...top.map((c) => ({ value: c.amountCents, color: c.tint })),
    ...(restCents > 0 ? [{ value: restCents, color: '#94a3b8' }] : []),
  ];

  const legend = [
    ...top,
    ...(restCents > 0
      ? [
          {
            categoryId: 'rest',
            label: t('budget.other'),
            tint: '#94a3b8',
            amountCents: restCents,
            share: restCents / totalCents,
          },
        ]
      : []),
  ];

  return (
    <View className="items-center gap-4">
      <DonutChart data={slices} size={180} strokeWidth={26}>
        <View className="w-full items-center">
          <Text variant="caption">{t('budget.spent')}</Text>
          <MoneyText
            cents={totalCents}
            currency={currency}
            size={20}
            minSize={13}
            align="center"
            className="font-sora-extrabold text-foreground"
          />
        </View>
      </DonutChart>

      {/* Two columns with a 24px gutter down the middle. Without it the left
          column's percentage sat flush against the right column's swatch, so
          "12%" and the next category's dot read as one run of marks and the
          eye had nothing to tell it where one entry ended. The percentages are
          also given a fixed end-aligned box, which turns them into a column
          that can be compared down rather than six numbers at six different
          indents. */}
      <View className="w-full flex-row flex-wrap">
        {legend.map((item, index) => (
          <View
            key={item.categoryId}
            className={
              index % 2 === 0
                ? 'w-1/2 flex-row items-center gap-2 py-1.5 pe-3'
                : 'w-1/2 flex-row items-center gap-2 py-1.5 ps-3'
            }
          >
            <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.tint }} />
            <Text variant="caption" className="flex-1" numberOfLines={1}>
              {item.label}
            </Text>
            <View className="items-end" style={{ minWidth: 34 }}>
              <Text
                variant="caption"
                className="font-sora-semibold text-foreground"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {Math.round(item.share * 100)}%
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
