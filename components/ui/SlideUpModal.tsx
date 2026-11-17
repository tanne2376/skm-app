import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet,
  TextInput, TouchableOpacity, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/constants';

/** Space kept between a focused input and the keyboard / top of the sheet. */
const FOCUS_MARGIN = 24;

interface SlideUpModalProps {
  visible: boolean;
  onDismiss: () => void;
  children: React.ReactNode;
  /**
   * Caps the sheet's height. Sheets that set this (or `fullScreen`) manage their
   * own scrolling (lists, pickers), so their content isn't wrapped in the
   * keyboard-aware ScrollView that form sheets get.
   */
  maxHeight?: number | `${number}%`;
  fullScreen?: boolean;
  /**
   * Called once the sheet has fully closed and its native modal is gone.
   * Present anything else modal (e.g. Stripe's PaymentSheet) from here: on
   * iOS, a view presented while this modal is still closing gets dismissed
   * along with it.
   */
  onClosed?: () => void;
}

export function SlideUpModal({ visible, onDismiss, children, maxHeight, fullScreen, onClosed }: SlideUpModalProps) {
  const insets = useSafeAreaInsets();
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const sheetY = useRef(new Animated.Value(600)).current;
  // Keep the Modal mounted until the close animation finishes
  const [mounted, setMounted] = useState(visible);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  // Form sheets scroll inside whatever space the keyboard leaves them
  const scrollable = !fullScreen && maxHeight == null;
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  // A newly mounted ScrollView (e.g. back from the full-screen picker) starts at
  // offset 0; drop the offset tracked for the previous instance.
  const attachScroll = useCallback((node: ScrollView | null) => {
    scrollRef.current = node;
    if (node) scrollY.current = 0;
  }, []);
  const viewportHeight = useRef(0);

  /** Scrolls the focused input (if it's in this sheet) clear of the keyboard. */
  const revealFocusedInput = useCallback(() => {
    const scroll = scrollRef.current;
    const input = TextInput.State.currentlyFocusedInput();
    // getInnerViewRef exists at runtime but is missing from RN's TS types; the
    // new architecture's measureLayout needs a host ref, not getInnerViewNode's tag.
    const content = (scroll as unknown as { getInnerViewRef?: () => View | null } | null)?.getInnerViewRef?.();
    if (!scroll || !input || !content || viewportHeight.current === 0) return;
    input.measureLayout(
      content,
      (_x, y, _w, h) => {
        const top = scrollY.current;
        const bottom = top + viewportHeight.current;
        if (y + h + FOCUS_MARGIN > bottom) {
          scroll.scrollTo({ y: y + h + FOCUS_MARGIN - viewportHeight.current, animated: true });
        } else if (y - FOCUS_MARGIN < top) {
          scroll.scrollTo({ y: Math.max(0, y - FOCUS_MARGIN), animated: true });
        }
      },
      () => {}, // focused input belongs to another view
    );
  }, []);

  useEffect(() => {
    if (!mounted || !scrollable) return;
    // Backstop for when the sheet's size doesn't change but the keyboard did
    const sub = Keyboard.addListener('keyboardDidShow', () => requestAnimationFrame(revealFocusedInput));
    return () => sub.remove();
  }, [mounted, scrollable, revealFocusedInput]);

  const onScrollLayout = useCallback((e: LayoutChangeEvent) => {
    viewportHeight.current = e.nativeEvent.layout.height;
    // The sheet shrinks when the keyboard pushes it up: re-check the focused input
    requestAnimationFrame(revealFocusedInput);
  }, [revealFocusedInput]);

  // Focus moving between inputs while the keyboard stays up fires no keyboard or
  // layout event. Focus only moves by tapping here, and TextInput focuses on
  // release, so re-check shortly after any touch in the sheet ends.
  const onSheetTouchEnd = useCallback(() => {
    setTimeout(revealFocusedInput, 50);
  }, [revealFocusedInput]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
  }, []);

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
        if (!finished) return;
        setMounted(false);
        // iOS reports this from the Modal's onDismiss, after the native dismissal.
        if (Platform.OS !== 'ios') onClosedRef.current?.();
      });
    }
  }, [visible]);

  return (
    <Modal
      visible={mounted}
      animationType="none"
      transparent
      onRequestClose={onDismiss}
      onDismiss={Platform.OS === 'ios' ? () => onClosedRef.current?.() : undefined}
    >
      {/* Fading backdrop — separate from the sheet */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]}>
        <TouchableOpacity style={{ flex: 1 }} onPress={onDismiss} activeOpacity={1} />
      </Animated.View>

      {/*
        The KAV must span the whole screen: it computes the keyboard overlap from
        its own layout frame (relative to its parent), so nested inside the
        bottom-anchored sheet it sees y=0 and never adds padding for short sheets.
        box-none lets taps above the sheet fall through to the backdrop.
      */}
      <KeyboardAvoidingView
        behavior={fullScreen && Platform.OS === 'android' ? 'height' : 'padding'}
        style={[styles.kav, !fullScreen && { paddingTop: insets.top }]}
        pointerEvents="box-none"
      >
        {/* Sliding sheet — shrinks (and scrolls) if the keyboard leaves too little room */}
        <Animated.View
          style={[
            fullScreen ? styles.sheetFull : styles.sheet,
            maxHeight != null && !fullScreen ? { maxHeight } : undefined,
            { transform: [{ translateY: sheetY }] },
          ]}
        >
          {scrollable ? (
            <ScrollView
              ref={attachScroll}
              style={styles.scroll}
              keyboardShouldPersistTaps="handled"
              bounces={false}
              overScrollMode="never"
              showsVerticalScrollIndicator={false}
              onLayout={onScrollLayout}
              onTouchEnd={onSheetTouchEnd}
              onScroll={onScroll}
              scrollEventThrottle={16}
            >
              {children}
            </ScrollView>
          ) : (
            children
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  kav: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    flexShrink: 1,
  },
  sheetFull: {
    flex: 1,
  },
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
});
