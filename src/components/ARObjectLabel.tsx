import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import type { WorldJamObject } from '@/types';
import { Waveform } from './Waveform';
import { colors, radius, spacing, type } from '@/theme';

interface Props {
  object: WorldJamObject;
  pcm: number[] | null;
  containerWidth: number;
  containerHeight: number;
  onTrigger: (id: string) => void;
  onLongPress: (id: string) => void;
  /**
   * Called when the user drags the object to a new place, with the new
   * position normalised to the stage (x is the label centre, y its top).
   */
  onMove?: (id: string, x: number, y: number) => void;
}

/** Finger travel, in px, before a touch counts as a drag rather than a tap. */
const DRAG_SLOP = 6;

const LABEL_WIDTH = 104;

/**
 * A captured object anchored over the camera view.
 *
 * On tap this fires two concentric rings that expand and fade outward, plus a
 * flash of the object's colour. The rings are the point: a flat label that
 * only changes opacity reads as a button, whereas something radiating outward
 * reads as a sound being emitted into the room — which is what is actually
 * happening.
 */
export function ARObjectLabel({
  object,
  pcm,
  containerWidth,
  containerHeight,
  onTrigger,
  onLongPress,
  onMove,
}: Props) {
  const breathe = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const flash = useRef(new Animated.Value(0)).current;

  // Two rings, staggered, so a tap produces a ripple rather than one pop.
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;

  // Drag state. The offset lives in an Animated value so the label follows the
  // finger without a React render per frame; the store is only told on release.
  const drag = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const lift = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);

  // Latest geometry for the responder, which is created once.
  const geom = useRef({ left: 0, top: 0, containerWidth, containerHeight, id: object.id, onMove });

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Only claim the touch once it moves: a still finger is a tap or a
        // long press and belongs to the Pressable underneath. Claiming in the
        // capture phase cancels that Pressable, so a drag never also plays or
        // deletes the object.
        onMoveShouldSetPanResponderCapture: (_, g) =>
          geom.current.onMove != null && Math.abs(g.dx) + Math.abs(g.dy) > DRAG_SLOP,
        onPanResponderGrant: () => {
          setDragging(true);
          Haptics.selectionAsync().catch(() => {});
          Animated.spring(lift, { toValue: 1, useNativeDriver: true, speed: 20 }).start();
        },
        onPanResponderMove: Animated.event([null, { dx: drag.x, dy: drag.y }], {
          useNativeDriver: false,
        }),
        onPanResponderRelease: (_, g) => {
          const { left, top, containerWidth: w, containerHeight: h, id, onMove: move } =
            geom.current;
          if (w > 0 && h > 0) {
            move?.(id, (left + g.dx + LABEL_WIDTH / 2) / w, (top + g.dy) / h);
          }
          drag.setValue({ x: 0, y: 0 });
          setDragging(false);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          Animated.spring(lift, { toValue: 0, useNativeDriver: true, speed: 20 }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(drag, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
          setDragging(false);
          Animated.spring(lift, { toValue: 0, useNativeDriver: true, speed: 20 }).start();
        },
      }),
    [drag, lift],
  );

  // Slow pulse so anchors read as live rather than as flat stickers.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 2000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathe]);

  const handlePress = () => {
    onTrigger(object.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    ring1.setValue(0);
    ring2.setValue(0);
    flash.setValue(1);

    Animated.parallel([
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.15, duration: 90, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 16 }),
      ]),
      Animated.timing(ring1, {
        toValue: 1,
        duration: 700,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      // The second ring starts late, so the ripple has depth.
      Animated.sequence([
        Animated.delay(120),
        Animated.timing(ring2, {
          toValue: 1,
          duration: 700,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(flash, {
        toValue: 0,
        duration: 450,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  };

  // Keep the label fully on screen even when captured near an edge.
  const left = Math.max(
    spacing.sm,
    Math.min(
      containerWidth - LABEL_WIDTH - spacing.sm,
      object.position.x * containerWidth - LABEL_WIDTH / 2,
    ),
  );
  const top = Math.max(
    spacing.xxl,
    Math.min(containerHeight - 110, object.position.y * containerHeight),
  );

  geom.current = { left, top, containerWidth, containerHeight, id: object.id, onMove };

  const ringStyle = (v: Animated.Value) => ({
    opacity: v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.8, 0] }),
    transform: [
      { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.75, 2.6] }) },
    ],
  });

  return (
    <Animated.View
      {...responder.panHandlers}
      style={[
        styles.wrap,
        dragging && styles.wrapDragging,
        { left, top, transform: [...drag.getTranslateTransform()] },
      ]}
    >
      <Animated.View
        style={{
          alignItems: 'center',
          transform: [
            { scale },
            { scale: lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] }) },
          ],
        }}
      >
      {/* Ripples, drawn behind the card and ignoring touches. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.ring, { borderColor: object.color }, ringStyle(ring1)]}
      />
      <Animated.View
        pointerEvents="none"
        style={[styles.ring, { borderColor: object.color }, ringStyle(ring2)]}
      />

      <Pressable
        onPress={handlePress}
        onLongPress={() => onLongPress(object.id)}
        delayLongPress={500}
        accessibilityRole="button"
        accessibilityLabel={`Play ${object.label}`}
        accessibilityHint="Drag to move it, which also pans its sound. Long press to delete."
      >
        {/* Soft halo that breathes, so the anchor reads as alive. */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.halo,
            {
              borderColor: object.color,
              opacity: breathe.interpolate({
                inputRange: [0, 1],
                outputRange: [0.2, 0.55],
              }),
              transform: [
                {
                  scale: breathe.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 1.06],
                  }),
                },
              ],
            },
          ]}
        />

        <View style={[styles.card, { borderColor: object.color }]}>
          {/* Colour wash on trigger. */}
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              styles.flash,
              {
                backgroundColor: object.color,
                opacity: flash.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 0.4],
                }),
              },
            ]}
          />

          <Text style={styles.name} numberOfLines={1}>
            {object.label}
          </Text>
          <Text style={[styles.role, { color: object.color }]} numberOfLines={1}>
            {object.role}
          </Text>

          <Waveform
            pcm={pcm}
            width={LABEL_WIDTH - spacing.md}
            height={20}
            color={object.color}
            bars={22}
          />
        </View>
      </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', width: LABEL_WIDTH, alignItems: 'center' },
  // Lifted objects draw above their neighbours.
  wrapDragging: { zIndex: 10, elevation: 10 },

  ring: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: LABEL_WIDTH,
    height: LABEL_WIDTH,
    marginLeft: -LABEL_WIDTH / 2,
    marginTop: -LABEL_WIDTH / 2,
    borderRadius: LABEL_WIDTH / 2,
    borderWidth: 2,
  },

  halo: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.md + 3,
    borderWidth: 3,
  },

  card: {
    width: LABEL_WIDTH,
    borderRadius: radius.md,
    borderWidth: 1.5,
    backgroundColor: 'rgba(10, 12, 16, 0.88)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: 3,
    alignItems: 'center',
    overflow: 'hidden',
  },
  flash: { borderRadius: radius.md },

  name: { ...type.label, fontSize: 12, color: colors.text },
  role: { ...type.caption, fontSize: 9, textTransform: 'lowercase' },
});
