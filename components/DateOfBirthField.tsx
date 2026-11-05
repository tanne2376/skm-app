import { useState } from 'react';
import { Platform, StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { COLORS } from '@/constants';
import { Button } from '@/components/ui/Button';
import { SlideUpModal } from '@/components/ui/SlideUpModal';
import { formatUKDate } from '@/lib/waiver';

const DEFAULT_PICKER_DOB = new Date(2015, 0, 1);

interface DateOfBirthFieldProps {
  value: Date | null;
  onChange: (d: Date) => void;
  /** Title of the iOS picker sheet and the field's accessibility label. */
  title?: string;
  style?: StyleProp<ViewStyle>;
}

/** Tappable date-of-birth field: a spinner sheet on iOS, the system dialog on Android. */
export function DateOfBirthField({ value, onChange, title = 'Date of Birth', style }: DateOfBirthFieldProps) {
  const [showSheet, setShowSheet] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const today = new Date();

  return (
    <>
      <TouchableOpacity
        style={[styles.input, style]}
        onPress={() => (Platform.OS === 'ios' ? setShowSheet(true) : setShowDialog(true))}
        accessibilityRole="button"
        accessibilityLabel={title}
      >
        <Text style={value ? styles.inputText : styles.placeholderText}>
          {value ? formatUKDate(value) : 'Select date'}
        </Text>
      </TouchableOpacity>

      {Platform.OS === 'android' && showDialog && (
        <DateTimePicker
          value={value ?? DEFAULT_PICKER_DOB}
          mode="date"
          display="default"
          maximumDate={today}
          onChange={(_: DateTimePickerEvent, d?: Date) => {
            setShowDialog(false);
            if (d) onChange(d);
          }}
        />
      )}

      <SlideUpModal visible={showSheet} onDismiss={() => setShowSheet(false)} maxHeight="45%">
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{title}</Text>
          <DateTimePicker
            value={value ?? DEFAULT_PICKER_DOB}
            mode="date"
            display="spinner"
            maximumDate={today}
            onChange={(_: DateTimePickerEvent, d?: Date) => d && onChange(d)}
            themeVariant="dark"
            style={styles.spinner}
          />
          <Button
            variant="primary"
            size="md"
            onPress={() => {
              // Spinner only fires onChange on scroll; accept the shown default too.
              if (!value) onChange(DEFAULT_PICKER_DOB);
              setShowSheet(false);
            }}
          >
            Done
          </Button>
        </View>
      </SlideUpModal>
    </>
  );
}

const styles = StyleSheet.create({
  input: { backgroundColor: COLORS.grey[800], borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: COLORS.grey[700], marginBottom: 4 },
  inputText: { color: COLORS.white, fontSize: 15 },
  placeholderText: { color: COLORS.grey[600], fontSize: 15 },
  sheet: {
    backgroundColor: COLORS.grey[900],
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 1, borderColor: COLORS.grey[800],
    padding: 20, paddingBottom: 40, gap: 12,
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.grey[700], alignSelf: 'center' },
  sheetTitle: { color: COLORS.white, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  spinner: { alignSelf: 'center' },
});
