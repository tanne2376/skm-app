import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, StyleSheet, TouchableOpacity } from 'react-native';
import { COLORS } from '@/constants';

interface SlideUpModalProps {
  visible: boolean;
  onDismiss: () => void;
  children: React.ReactNode;
  maxHeight?: number | `${number}%`;
  fullScreen?: boolean;
}

export function SlideUpModal({ visible, onDismiss, children, maxHeight, fullScreen }: SlideUpModalProps) {
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const sheetY = useRef(new Animated.Value(600)).current;
  // Keep the Modal mounted until the close animation finishes
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      backdropOpacity.setValue(0);
      sheetY.setValue(600);
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 1, duration: 250, useNativeDriver: true,
        }),
        Animated.spring(sheetY, {
          toValue: 0, useNativeDriver: true, bounciness: 0, speed: 20,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 0, duration: 220, useNativeDriver: true,
        }),
        Animated.timing(sheetY, {
          toValue: 600, duration: 240, useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible]);

  return (
    <Modal visible={mounted} animationType="none" transparent onRequestClose={onDismiss}>
      {/* Fading backdrop — separate from the sheet */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]}>
        <TouchableOpacity style={{ flex: 1 }} onPress={onDismiss} activeOpacity={1} />
      </Animated.View>

      {/* Sliding sheet */}
      <Animated.View
        style={[
          styles.sheetWrapper,
          fullScreen ? styles.sheetWrapperFull : maxHeight ? { maxHeight } : undefined,
          { transform: [{ translateY: sheetY }] },
        ]}
      >
        {children}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  sheetWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  sheetWrapperFull: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
});
