import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format } from 'date-fns/format';
import { set } from 'date-fns/set';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, View } from 'react-native';

import { formatDate, formatTime } from '@/lib/date-format';
import { CalendarDays, Clock, Minus, Plus } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Chip } from '@/components/ui/chip';
import { cardClass } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StarRating } from '@/components/ui/star-rating';
import { InlineError } from '@/components/ui/query-error';
import { SheetHeader } from '@/components/ui/sheet-header';
import { Text } from '@/components/ui/text';
import { moduleTint, moduleTints } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { SubjectPicker } from '@/features/study/components/subject-picker';
import { formatStudyDuration } from '@/features/study/services/study-stats';
import { useStudySubjects } from '@/features/study/hooks/use-study';
import { useStudyMutations } from '@/features/study/hooks/use-study-mutations';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes';
import { toast } from '@/lib/toast-store';

const QUICK_MINUTES = [15, 25, 50, 90];

/** Manually logs a past / offline study session — the tracker for time spent
 * away from the live timer (studying from a book, class, etc.). */
export default function StudyLogScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const studyTint = moduleTint('study', scheme);
  const subjectsQuery = useStudySubjects();
  const { data: subjects = [] } = subjectsQuery;
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

  // Date and start time default to "now", so only a deliberate change to them
  // — or any of the fields that start empty — is unsaved work.
  const release = useUnsavedChanges(
    subjectId !== null || minutes !== 25 || rating !== null || note.trim() !== '',
  );

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
    release();
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
          {/* Inline, not a full-screen error: logging a session is the point of
              this screen and works with no subject at all. But an empty picker
              reads as "you have no subjects", and the create affordance right
              below it would then make a second copy of one the person already
              has. Saying the list failed is what stops that. */}
          {subjectsQuery.isError ? <InlineError error={subjectsQuery.error} /> : null}
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
              <Chip
                key={m}
                label={t('study.minutesShort', { minutes: m })}
                selected={minutes === m}
                tint={moduleTints.study}
                onPress={() => setMinutes(m)}
              />
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
                <Text className="font-sora-semibold text-foreground">
                  {formatDate(date, 'dayMonth')}
                </Text>
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
                <Text className="font-sora-semibold text-foreground">{formatTime(startTime)}</Text>
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
          <Text variant="sectionLabel">{t('study.howFocusedOptional')}</Text>
          <StarRating value={rating} onChange={setRating} />
        </View>

        <Input value={note} onChangeText={setNote} placeholder={t('study.notePlaceholder')} />

        <Button label={t('study.saveSession')} onPress={save} size="lg" variant="accent" />
      </ScrollView>
    </View>
  );
}
