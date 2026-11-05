import { StyleSheet, Text, View } from 'react-native';
import { COLORS } from '@/constants';
import { CURRENT_WAIVER_CONTENT, WaiverContent } from '@/constants/waiver';

/**
 * The acknowledgment's heading and terms, shared by the signing screen
 * (current wording) and the read-only screen (the wording that was signed).
 */
export function WaiverText({ content = CURRENT_WAIVER_CONTENT }: { content?: WaiverContent }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{content.title}</Text>
      <Text style={styles.subtitle}>{content.subtitle}</Text>
      {content.sections.map((s) => (
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
