import { useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { COLORS } from '@/constants';
import { buildSignatureSvg, SignatureStroke, strokeToPath } from '@/lib/waiver';

interface SignaturePadProps {
  /** Called with the SVG document after each stroke, or null once cleared. */
  onChange: (svg: string | null) => void;
  /** Lets a parent ScrollView disable scrolling while the user draws. */
  onDrawingChange?: (drawing: boolean) => void;
  height?: number;
  accessibilityLabel?: string;
}

export function SignaturePad({ onChange, onDrawingChange, height = 160, accessibilityLabel }: SignaturePadProps) {
  const [strokes, setStrokes] = useState<SignatureStroke[]>([]);
  const size = useRef({ width: 0, height });
  // PanResponder is created once, so read the latest callbacks through refs.
  const callbacks = useRef({ onChange, onDrawingChange });
  callbacks.current = { onChange, onDrawingChange };
  const strokesRef = useRef<SignatureStroke[]>([]);
  // locationX/Y are unreliable during moves on iOS (they can be reported
  // relative to another view), so track page coordinates minus the pad's
  // page offset captured at touch start. Scrolling is off while drawing.
  const origin = useRef({ x: 0, y: 0 });

  const commit = (next: SignatureStroke[]) => {
    strokesRef.current = next;
    setStrokes(next);
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          callbacks.current.onDrawingChange?.(true);
          const { locationX: x, locationY: y, pageX, pageY } = e.nativeEvent;
          origin.current = { x: pageX - x, y: pageY - y };
          commit([...strokesRef.current, [{ x, y }]]);
        },
        onPanResponderMove: (e) => {
          const { pageX, pageY } = e.nativeEvent;
          const { width, height: h } = size.current;
          const x = Math.min(Math.max(pageX - origin.current.x, 0), width);
          const y = Math.min(Math.max(pageY - origin.current.y, 0), h);
          const all = strokesRef.current;
          const last = all[all.length - 1];
          if (!last) return;
          commit([...all.slice(0, -1), [...last, { x, y }]]);
        },
        onPanResponderRelease: () => finish(),
        onPanResponderTerminate: () => finish(),
      }),
    [],
  );

  function finish() {
    callbacks.current.onDrawingChange?.(false);
    const { width, height: h } = size.current;
    callbacks.current.onChange(buildSignatureSvg(strokesRef.current, width, h));
  }

  function clear() {
    commit([]);
    onChange(null);
  }

  function onLayout(e: LayoutChangeEvent) {
    size.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
  }

  return (
    <View>
      <View
        style={[styles.pad, { height }]}
        onLayout={onLayout}
        accessibilityLabel={accessibilityLabel}
        {...panResponder.panHandlers}
      >
        {strokes.length === 0 && (
          <Text style={styles.placeholder} pointerEvents="none">Sign here</Text>
        )}
        <View style={styles.baseline} pointerEvents="none" />
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          {strokes.map((s, i) => (
            <Path
              key={i}
              d={strokeToPath(s)}
              fill="none"
              stroke="#000"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </Svg>
      </View>
      <TouchableOpacity onPress={clear} style={styles.clearBtn} disabled={strokes.length === 0}>
        <Text style={[styles.clearText, strokes.length === 0 && styles.clearDisabled]}>Clear</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: {
    backgroundColor: COLORS.white,
    borderRadius: 8,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholder: { color: COLORS.grey[400], fontSize: 15 },
  baseline: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 32,
    height: 1,
    backgroundColor: COLORS.grey[300],
  },
  clearBtn: { alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 4 },
  clearText: { color: COLORS.accent, fontSize: 14, fontWeight: '600' },
  clearDisabled: { color: COLORS.grey[700] },
});
