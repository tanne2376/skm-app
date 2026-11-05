import { useState } from 'react';
import { Alert, StyleProp, StyleSheet, Text, TextInput, View, ViewStyle } from 'react-native';
import { COLORS } from '@/constants';
import { Button } from '@/components/ui/Button';
import { DateOfBirthField } from '@/components/DateOfBirthField';
import { newChildError, toISODate } from '@/lib/waiver';
import { NewChild } from '@/types';

interface AddChildFormProps {
  /** Resolve to clear the form; throw to keep it and show the error. */
  onAdd: (child: NewChild) => Promise<void> | void;
  loading?: boolean;
  /** Lets screens with their own input look (e.g. register) restyle the fields. */
  inputStyle?: StyleProp<ViewStyle>;
}

/** Name + date of birth for a child under 18, with an Add button. */
export function AddChildForm({ onAdd, loading, inputStyle }: AddChildFormProps) {
  const [fullName, setFullName] = useState('');
  const [dob, setDob] = useState<Date | null>(null);

  async function handleAdd() {
    const problem = newChildError(fullName, dob);
    if (problem) {
      Alert.alert('Check the details', problem);
      return;
    }
    try {
      await onAdd({ full_name: fullName.trim(), date_of_birth: toISODate(dob!) });
      setFullName('');
      setDob(null);
    } catch (e) {
      Alert.alert('Could not add child', e instanceof Error ? e.message : 'Please try again.');
    }
  }

  return (
    <View>
      <Text style={styles.label}>Child's full name</Text>
      <TextInput
        style={[styles.input, inputStyle]}
        value={fullName}
        onChangeText={setFullName}
        autoCapitalize="words"
        placeholder="Sam Smith"
        placeholderTextColor={COLORS.grey[600]}
        accessibilityLabel="Child's full name"
      />
      <Text style={styles.label}>Child's date of birth</Text>
      <DateOfBirthField value={dob} onChange={setDob} title="Child's Date of Birth" style={inputStyle} />
      <Button variant="secondary" size="md" onPress={handleAdd} loading={loading} style={styles.button}>
        Add Child
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: COLORS.grey[400], fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6, marginTop: 8 },
  input: { backgroundColor: COLORS.grey[800], borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, color: COLORS.white, fontSize: 15, borderWidth: 1, borderColor: COLORS.grey[700], marginBottom: 4 },
  button: { marginTop: 12 },
});
