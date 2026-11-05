import { StyleSheet, Text, View } from 'react-native';
import { COLORS } from '@/constants';
import { WAIVER_SECTIONS, WAIVER_SUBTITLE, WAIVER_TITLE } from '@/constants/waiver';

/** The acknowledgment's heading and terms, shared by the signing and read-only screens. */
export function WaiverText() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{WAIVER_TITLE}</Text>
      <Text style={styles.subtitle}>{WAIVER_SUBTITLE}</Text>
      {WAIVER_SECTIONS.map((s) => (
        <View key={s.heading}>
          <Text style={styles.heading}>{s.heading}</Text>
          <Text style={styles.body}>{s.body}</Text>
        </View>
      ))}
    </View>
  );
}

export const waiverTextStyles = StyleSheet.create({
  heading: { color: COLORS.oliveLight, fontSize: 13, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  body: { color: COLORS.grey[300], fontSize: 14, lineHeight: 21 },
});

const styles = StyleSheet.create({
  container: { gap: 16 },
  title: { color: COLORS.white, fontSize: 20, fontWeight: '800', textTransform: 'uppercase' },
  subtitle: { color: COLORS.accent, fontSize: 13, fontWeight: '700', marginTop: -10 },
  heading: waiverTextStyles.heading,
  body: waiverTextStyles.body,
});
