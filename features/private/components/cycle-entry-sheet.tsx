import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { Image } from 'expo-image';
import { forwardRef, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, View } from 'react-native';

import { Camera, ImagePlus, Trash2, X } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { CycleDateField } from '@/features/private/components/cycle-date-field';
import { ChipRow } from '@/features/private/components/private-screen';
import { TagInput } from '@/features/private/components/tag-input';
import {
  SYMPTOMS,
  type CycleEntry,
  type CycleFields,
  type Flow,
  type Symptom,
} from '@/features/private/services/cycle-math';
import {
  MAX_VAULT_MB,
  pickIntoVault,
  readVaultFileAsDataUri,
} from '@/features/private/services/vault-files';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';
import { confirm } from '@/lib/dialog-store';
import { toast } from '@/lib/toast-store';

const FLOWS: Flow[] = ['spotting', 'light', 'medium', 'heavy'];
const MOODS = [1, 2, 3, 4, 5] as const;

/** Either an entry being edited, or a date (plus optionally some fields
 *  already known — e.g. "More details" seeds today's date and whatever the
 *  inline quick-log form already has typed) to create one on. The month
 *  strip and history list pass a bare date; the inline form's "More
 *  details" button passes a partial prefill. */
export type CycleEntryTarget = CycleEntry | ({ date: string } & Partial<CycleFields>);

function isExisting(target: CycleEntryTarget): target is CycleEntry {
  return 'id' in target;
}

const emptyFields = (date: string): CycleFields => ({
  date,
  flow: null,
  symptoms: [],
  mood: null,
  note: '',
  basalTempC: null,
  weightKg: null,
  medications: [],
  customTags: [],
  photoFileNames: [],
});

type Props = {
  target: CycleEntryTarget | null;
  tint: string;
  suggestions: { customTags: string[]; medications: string[] };
  onSave: (fields: CycleFields, id: string | null) => void;
  onDelete: (entry: CycleEntry) => void;
};

/**
 * The "everything else" surface for a Cycle entry.
 *
 * The always-visible inline form on cycle.tsx stays a fast, today-only
 * "flow + symptoms + note" habit loop — this sheet is where every richer
 * field lives, AND the only place a past date gets logged or an existing
 * entry gets edited (the month strip and history rows both open it here).
 */
export const CycleEntrySheet = forwardRef<BottomSheetModal, Props>(function CycleEntrySheet(
  { target, tint, suggestions, onSave, onDelete },
  ref,
) {
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const { t } = useTranslation();

  const [fields, setFields] = useState<CycleFields>(() => emptyFields(target?.date ?? ''));
  const [busy, setBusy] = useState(false);

  // The sheet is one mounted instance reused across opens — reseed local
  // state every time the caller hands it a new target.
  useEffect(() => {
    if (!target) return;
    setFields(isExisting(target) ? { ...target } : { ...emptyFields(target.date), ...target });
  }, [target]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.4} />
    ),
    [],
  );

  const set = <K extends keyof CycleFields>(key: K, value: CycleFields[K]) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  const addPhotos = async (source: 'library' | 'camera') => {
    setBusy(true);
    try {
      const { items, rejectedOversize, permissionDenied } = await pickIntoVault(source);
      if (permissionDenied) {
        void confirm({
          title: t(
            source === 'camera'
              ? 'permissions.cameraDeniedTitle'
              : 'permissions.mediaLibraryDeniedTitle',
          ),
          message: t(
            source === 'camera'
              ? 'permissions.cameraDeniedBody'
              : 'permissions.mediaLibraryDeniedBody',
          ),
          confirmLabel: t('permissions.openSettings'),
          cancelLabel: t('common.cancel'),
        }).then((ok) => {
          if (ok) void Linking.openSettings();
        });
      }
      if (items.length > 0) {
        set('photoFileNames', [...fields.photoFileNames, ...items.map((i) => i.file.fileName)]);
      }
      if (rejectedOversize > 0) {
        toast.error(t('private.tooLargeBody', { count: rejectedOversize, mb: MAX_VAULT_MB }));
      }
    } finally {
      setBusy(false);
    }
  };

  const removePhoto = (fileName: string) =>
    set(
      'photoFileNames',
      fields.photoFileNames.filter((f) => f !== fileName),
    );
  // Note: a photo removed mid-edit before Save is only detached from this
  // draft, not deleted from disk here — cycle.tsx's save path reconciles
  // dropped attachments against the previously-saved entry so an edit that's
  // never confirmed can't lose bytes a cancel should have left untouched.

  const save = () => {
    if (
      !isExisting(target!) &&
      !fields.flow &&
      fields.symptoms.length === 0 &&
      !fields.note.trim()
    ) {
      return;
    }
    onSave(fields, isExisting(target!) ? target!.id : null);
    if (ref && 'current' in ref) ref.current?.dismiss();
  };

  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: theme.card }}
      handleIndicatorStyle={{ backgroundColor: theme.border }}
    >
      <BottomSheetScrollView contentContainerClassName="gap-5 px-5 pb-10 pt-2">
        <View className="flex-row items-center justify-between">
          <Text variant="subheading">
            {target && isExisting(target) ? t('private.editEntry') : t('private.newEntry')}
          </Text>
          <CycleDateField value={fields.date} onChange={(date) => set('date', date)} />
        </View>

        <View className="gap-3">
          <Text variant="micro">{t('private.flow')}</Text>
          <View className="flex-row gap-2">
            {FLOWS.map((option) => {
              const active = fields.flow === option;
              return (
                <Pressable
                  key={option}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  onPress={() => set('flow', active ? null : option)}
                  className="flex-1 items-center rounded-2xl border py-3"
                  style={{
                    borderColor: active ? tint : theme.border,
                    backgroundColor: active ? alpha(tint, 0.12) : 'transparent',
                  }}
                >
                  <Text
                    className="font-sora-medium text-sm"
                    style={{ color: active ? tint : theme.foreground }}
                  >
                    {t(`private.flow_${option}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View className="gap-3">
          <Text variant="micro">{t('private.mood')}</Text>
          <View className="flex-row gap-2">
            {MOODS.map((m) => {
              const active = fields.mood === m;
              return (
                <Pressable
                  key={m}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  onPress={() => set('mood', active ? null : m)}
                  className="h-11 flex-1 items-center justify-center rounded-full border"
                  style={{
                    borderColor: active ? tint : theme.border,
                    backgroundColor: active ? alpha(tint, 0.12) : 'transparent',
                  }}
                >
                  <Text
                    className="font-sora-semibold"
                    style={{ color: active ? tint : theme.foreground }}
                  >
                    {m}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View className="gap-3">
          <Text variant="micro">{t('private.symptoms')}</Text>
          <ChipRow
            options={SYMPTOMS}
            selected={fields.symptoms}
            tint={tint}
            labelFor={(s: Symptom) => t(`private.symptom_${s}`)}
            onToggle={(s) =>
              set(
                'symptoms',
                fields.symptoms.includes(s)
                  ? fields.symptoms.filter((x) => x !== s)
                  : [...fields.symptoms, s],
              )
            }
          />
        </View>

        <View className="flex-row gap-3">
          <View className="flex-1 gap-2">
            <Text variant="micro">{t('private.basalTemp')}</Text>
            <Input
              surface="bare"
              as={BottomSheetTextInput}
              value={fields.basalTempC === null ? '' : String(fields.basalTempC)}
              onChangeText={(text) => {
                const parsed = parseFloat(text);
                set('basalTempC', text.trim() === '' || !Number.isFinite(parsed) ? null : parsed);
              }}
              keyboardType="decimal-pad"
              placeholder="36.6"
              style={{
                color: theme.foreground,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 14,
                paddingHorizontal: 14,
                paddingVertical: 10,
              }}
            />
          </View>
          <View className="flex-1 gap-2">
            <Text variant="micro">{t('private.weight')}</Text>
            <Input
              surface="bare"
              as={BottomSheetTextInput}
              value={fields.weightKg === null ? '' : String(fields.weightKg)}
              onChangeText={(text) => {
                const parsed = parseFloat(text);
                set('weightKg', text.trim() === '' || !Number.isFinite(parsed) ? null : parsed);
              }}
              keyboardType="decimal-pad"
              placeholder="60"
              style={{
                color: theme.foreground,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 14,
                paddingHorizontal: 14,
                paddingVertical: 10,
              }}
            />
          </View>
        </View>

        <View className="gap-2">
          <Text variant="micro">{t('private.medications')}</Text>
          <TagInput
            value={fields.medications}
            onChange={(v) => set('medications', v)}
            suggestions={suggestions.medications}
            tint={tint}
            placeholder={t('private.addMedication')}
          />
        </View>

        <View className="gap-2">
          <Text variant="micro">{t('private.customTags')}</Text>
          <TagInput
            value={fields.customTags}
            onChange={(v) => set('customTags', v)}
            suggestions={suggestions.customTags}
            tint={tint}
            placeholder={t('private.addTag')}
          />
        </View>

        <View className="gap-2">
          <Text variant="micro">{t('private.photos')}</Text>
          <View className="flex-row flex-wrap gap-2">
            {fields.photoFileNames.map((fileName) => (
              <EntryPhotoThumb
                key={fileName}
                fileName={fileName}
                onRemove={() => removePhoto(fileName)}
              />
            ))}
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void addPhotos('library')}
              className="h-16 w-16 items-center justify-center rounded-xl border border-dashed"
              style={{ borderColor: theme.border, opacity: busy ? 0.5 : 1 }}
            >
              <ImagePlus size={18} color={theme.mutedForeground} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void addPhotos('camera')}
              className="h-16 w-16 items-center justify-center rounded-xl border border-dashed"
              style={{ borderColor: theme.border, opacity: busy ? 0.5 : 1 }}
            >
              <Camera size={18} color={theme.mutedForeground} />
            </Pressable>
          </View>
        </View>

        <View className="gap-2">
          <Text variant="micro">{t('private.notes')}</Text>
          <Input
            surface="bare"
            as={BottomSheetTextInput}
            value={fields.note}
            onChangeText={(text) => set('note', text)}
            placeholder={t('private.notePlaceholder')}
            multiline
            style={{
              color: theme.foreground,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 14,
              paddingHorizontal: 14,
              paddingVertical: 10,
              minHeight: 88,
              textAlignVertical: 'top',
            }}
          />
        </View>

        <Button variant="accent" size="lg" label={t('common.save')} onPress={save} />

        {target && isExisting(target) ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onDelete(target);
              if (ref && 'current' in ref) ref.current?.dismiss();
            }}
            className="flex-row items-center justify-center gap-1.5 py-2"
          >
            <Trash2 size={14} color={theme.destructive} />
            <Text variant="caption" style={{ color: theme.destructive }}>
              {t('private.deleteEntry')}
            </Text>
          </Pressable>
        ) : null}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

function EntryPhotoThumb({ fileName, onRemove }: { fileName: string; onRemove: () => void }) {
  const theme = colors[useColorScheme() ?? 'light'];
  const uri = readVaultFileAsDataUri(fileName, 'image/jpeg');
  return (
    <View className="h-16 w-16 overflow-hidden rounded-xl">
      {uri ? (
        <Image source={{ uri }} style={{ width: '100%', height: '100%' }} cachePolicy="none" />
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={onRemove}
        hitSlop={6}
        className="absolute right-1 top-1 h-5 w-5 items-center justify-center rounded-full"
        style={{ backgroundColor: alpha(theme.background, 0.85) }}
      >
        <X size={11} color={theme.foreground} />
      </Pressable>
    </View>
  );
}
