import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format, set } from 'date-fns';
import { useRouter } from 'expo-router';
import { CalendarDays, Clock, Minus, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StarRating } from '@/components/ui/star-rating';
import { SheetHeader } from '@/components/ui/sheet-header';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { SubjectPicker } from '@/features/study/components/subject-picker';
import { formatStudyDuration } from '@/features/study/services/study-stats';
import { useStudySubjects } from '@/features/study/hooks/use-study';
import { useStudyMutations } from '@/features/study/hooks/use-study-mutations';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { toast } from '@/lib/toast-store';

const QUICK_MINUTES = [15, 25, 50, 90];

/** Manually logs a past / offline study session — the tracker for time spent
 * away from the live timer (studying from a book, class, etc.). */
export default function StudyLogScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const studyTint = moduleTint('study', scheme);
  const { data: subjects = [] } = useStudySubjects();
  const { logSession, addSubject } = useStudyMutations();

  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [date, setDate] = useState(() => new Date());
  const [startTime, setStartTime] = useState(() =>
    set(new Date(), { seconds: 0, milliseconds: 0 }),
  );
  const [minutes, setMinutes] = useState(25);
  const [rating, setRating] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);

  const handleDate = (event: DateTimePickerEvent, value?: Date) => {
    if (Platform.OS === 'android') setShowDate(false);
    if (event.type === 'set' && value) setDate(value);
  };
  const handleTime = (event: DateTimePickerEvent, value?: Date) => {
    if (Platform.OS === 'android') setShowTime(false);
    if (event.type === 'set' && value) setStartTime(value);
  };

  const adjust = (delta: number) => setMinutes((m) => Math.min(600, Math.max(5, m + delta)));

  const save = () => {
    const startedAt = set(date, {
      hours: startTime.getHours(),
      minutes: startTime.getMinutes(),
      seconds: 0,
      milliseconds: 0,
    }).getTime();
    if (startedAt > Date.now()) {
      toast.error(t('study.futureBody'));
      return;
    }
    logSession.mutate({
      subjectId,
      logDate: format(date, 'yyyy-MM-dd'),
      startedAt,
      endedAt: startedAt + minutes * 60_000,
      durationSeconds: minutes * 60,
      mode: 'custom',
      focusRating: rating,
      note: note.trim() || null,
    });
    router.back();
  };

  return (
    <View className="flex-1 bg-background">
      <SheetHeader title={t('study.logStudyTitle')} />

      <ScrollView
        contentContainerClassName="gap-5 px-5 pt-3 pb-10"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-2.5">
          <Text variant="micro">{t('study.subject')}</Text>
          <SubjectPicker
            subjects={subjects}
            value={subjectId}
            onChange={setSubjectId}
            onCreate={(name, colorToken) =>
              addSubject.mutate(
                { name, colorToken },
                { onSuccess: (created) => setSubjectId(created.id) },
              )
            }
          />
        </View>

        {/* Duration */}
        <View className={cardClass({ padding: 'lg', elevation: 'e1' }, 'items-center gap-3')}>
          <Text variant="micro">{t('study.howLong')}</Text>
          <View className="flex-row items-center gap-6">
            <Pressable
              accessibilityRole="button"
              onPress={() => adjust(-5)}
              className="h-11 w-11 items-center justify-center rounded-2xl border border-border bg-surface"
              accessibilityLabel={t('study.less')}
            >
              <Minus size={20} color={colors[scheme].foreground} />
            </Pressable>
            <Text
              className="font-sora-extrabold text-3xl"
              style={{
                color: studyTint,
                minWidth: 120,
                textAlign: 'center',
                fontVariant: ['tabular-nums'],
              }}
            >
              {formatStudyDuration(minutes * 60)}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => adjust(5)}
              className="h-11 w-11 items-center justify-center rounded-2xl bg-study"
              accessibilityLabel={t('study.more')}
            >
              <Plus size={20} color="#ffffff" />
            </Pressable>
          </View>
          <View className="flex-row flex-wrap justify-center gap-2">
            {QUICK_MINUTES.map((m) => (
              <Pressable
                accessibilityRole="button"
                key={m}
                onPress={() => setMinutes(m)}
                className="rounded-full border border-border px-3.5 py-1.5"
                style={
                  minutes === m ? { backgroundColor: studyTint, borderColor: studyTint } : undefined
                }
              >
                <Text
                  className={
                    minutes === m ? 'font-sora-semibold text-white' : 'text-muted-foreground'
                  }
                >
                  {t('study.minutesShort', { minutes: m })}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* When */}
        <View className="flex-row gap-3">
          <View
            className={cardClass(
              { padding: 'row' },
              'flex-1 flex-row items-center justify-between',
            )}
          >
            <CalendarDays size={16} color={colors[scheme].mutedForeground} />
            {Platform.OS === 'ios' ? (
              <DateTimePicker
                value={date}
                mode="date"
                display="compact"
                maximumDate={new Date()}
                onChange={handleDate}
              />
            ) : (
              <Pressable accessibilityRole="button" onPress={() => setShowDate(true)}>
                <Text className="font-sora-semibold text-foreground">{format(date, 'MMM d')}</Text>
              </Pressable>
            )}
          </View>
          <View
            className={cardClass(
              { padding: 'row' },
              'flex-1 flex-row items-center justify-between',
            )}
          >
            <Clock size={16} color={colors[scheme].mutedForeground} />
            {Platform.OS === 'ios' ? (
              <DateTimePicker
                value={startTime}
                mode="time"
                display="compact"
                onChange={handleTime}
              />
            ) : (
              <Pressable accessibilityRole="button" onPress={() => setShowTime(true)}>
                <Text className="font-sora-semibold text-foreground">
                  {format(startTime, 'h:mm a')}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
        {Platform.OS === 'android' && showDate && (
          <DateTimePicker
            value={date}
            mode="date"
            display="default"
            maximumDate={new Date()}
            onChange={handleDate}
          />
        )}
        {Platform.OS === 'android' && showTime && (
          <DateTimePicker value={startTime} mode="time" display="default" onChange={handleTime} />
        )}

        <View className="items-center gap-2">
          <Text variant="caption" className="font-sora-semibold uppercase tracking-wide">
            {t('study.howFocusedOptional')}
          </Text>
          <StarRating value={rating} onChange={setRating} />
        </View>

        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder={t('study.notePlaceholder')}
          placeholderTextColor={colors[scheme].mutedForeground}
          className={cardClass({ padding: 'row' }, 'text-foreground')}
        />

        <Button label={t('study.saveSession')} onPress={save} size="lg" variant="accent" />
      </ScrollView>
    </View>
  );
}
