import { format, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { BookOpen, Star } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { formatStudyDuration } from '@/features/study/services/study-stats';
import type { StudySession, StudySubject } from '@/features/study/types/study.types';
import { contentTints } from '@/constants/design-tokens';
import { useTheme } from '@/hooks/use-theme';

const MODE_LABEL_KEY: Record<StudySession['mode'], string> = {
  pomodoro: 'study.modePomodoro',
  custom: 'study.modeCustom',
  stopwatch: 'study.modeStopwatch',
};

type Props = {
  session: StudySession;
  subject: StudySubject | null;
  onLongPress: (session: StudySession) => void;
};

export function StudySessionCard({ session, subject, onLongPress }: Props) {
  const { tint, resolve } = useTheme();
  // The session rating star. Content yellow, whose light value is the `#eab308`
  // this was hardcoded to — so light is unchanged and dark finally steps up.
  const starColor = resolve(contentTints.yellow);
  const { t } = useTranslation();
  const color = subject?.colorToken ?? tint('study');

  return (
    <Pressable
      onLongPress={() => onLongPress(session)}
      className={cardClass({ padding: 'md' }, 'flex-row items-center gap-3')}
      accessibilityHint={t('study.longPressDelete')}
    >
      <View
        className="h-11 w-11 items-center justify-center rounded-xl"
        style={{ backgroundColor: `${color}1f` }}
      >
        <BookOpen size={19} color={color} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="font-sora-semibold text-foreground" numberOfLines={1}>
          {subject?.name ?? t('study.general')}
          {session.note ? ` · ${session.note}` : ''}
        </Text>
        <Text variant="caption">
          {format(parseISO(session.logDate), 'EEE, MMM d')} · {t(MODE_LABEL_KEY[session.mode])}
        </Text>
      </View>
      <View className="items-end gap-1">
        <Text className="font-sora-bold" style={{ color }}>
          {formatStudyDuration(session.durationSeconds)}
        </Text>
        {session.focusRating != null && (
          <View className="flex-row items-center gap-0.5">
            <Star size={11} color={starColor} fill={starColor} />
            <Text variant="caption">{session.focusRating}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}
