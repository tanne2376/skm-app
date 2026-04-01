import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, ViewStyle } from 'react-native';
import { COLORS } from '@/constants';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: string;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  onPress,
  children,
  style,
  accessibilityLabel,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      style={[
        styles.base,
        styles[`size_${size}`],
        styles[`variant_${variant}`],
        isDisabled && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? children}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
    >
      {loading
        ? <ActivityIndicator color={variant === 'secondary' ? COLORS.black : COLORS.white} size="small" />
        : <Text style={[styles.text, styles[`text_${variant}`], styles[`textSize_${size}`]]}>{children}</Text>
      }
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    flexDirection: 'row',
  },
  disabled: { opacity: 0.5 },

  size_sm: { paddingVertical: 8, paddingHorizontal: 16 },
  size_md: { paddingVertical: 13, paddingHorizontal: 20 },
  size_lg: { paddingVertical: 16, paddingHorizontal: 24 },

  variant_primary: { backgroundColor: COLORS.accent },
  variant_secondary: { backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.grey[200] },
  variant_ghost: { backgroundColor: 'transparent' },
  variant_danger: { backgroundColor: COLORS.error },

  text: { fontWeight: '700', letterSpacing: 0.3 },
  text_primary: { color: COLORS.white },
  text_secondary: { color: COLORS.black },
  text_ghost: { color: COLORS.white },
  text_danger: { color: COLORS.white },

  textSize_sm: { fontSize: 13 },
  textSize_md: { fontSize: 15 },
  textSize_lg: { fontSize: 16 },
});
