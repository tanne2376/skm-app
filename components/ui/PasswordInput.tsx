import { useState } from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet, TextInputProps, StyleProp, ViewStyle } from 'react-native';
import { COLORS } from '@/constants';

type Props = Omit<TextInputProps, 'secureTextEntry'> & {
  containerStyle?: StyleProp<ViewStyle>;
};

export function PasswordInput({ style, containerStyle, ...rest }: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={[styles.container, containerStyle]}>
      <TextInput
        {...rest}
        style={[style, styles.input]}
        secureTextEntry={!visible}
        placeholderTextColor={rest.placeholderTextColor ?? COLORS.grey[600]}
      />
      <TouchableOpacity
        style={styles.toggle}
        onPress={() => setVisible((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Hide password' : 'Show password'}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Text style={styles.toggleText}>{visible ? 'Hide' : 'Show'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { justifyContent: 'center' },
  input: { paddingRight: 60 },
  toggle: {
    position: 'absolute',
    right: 12,
    padding: 4,
  },
  toggleText: {
    color: COLORS.grey[400],
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
