import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { createContext, useContext, type ComponentRef, type ReactNode, type RefObject } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius as radii } from '@/theme/tokens';

type BlurTargetRef = RefObject<ComponentRef<typeof View> | null>;

/**
 * Android can only blur what sits behind a BlurView if it is told which view to sample.
 * Only overlay surfaces (dock, sheets) live outside that view, so only they receive the ref;
 * surfaces inside screen content fall back to a translucent fill, which also limits blur cost.
 */
export const BlurTargetContext = createContext<BlurTargetRef | null>(null);

export interface GlassSurfaceProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** 1-100 blur strength. */
  intensity?: number;
  radius?: number;
  /** Background fill; defaults to the glass token. */
  tint?: string;
  borderColor?: string;
  padding?: number;
}

export function GlassSurface({
  children,
  style,
  intensity = 40,
  radius = radii.lg,
  tint = colors.glass,
  borderColor = colors.glassBorder,
  padding,
}: GlassSurfaceProps) {
  const target = useContext(BlurTargetContext);
  const real = Platform.OS === 'ios' || (Platform.OS === 'android' && target !== null && Number(Platform.Version) >= 31);

  return (
    <View
      style={[
        { borderRadius: radius, borderWidth: StyleSheet.hairlineWidth * 1.5, borderColor, overflow: 'hidden', padding },
        style,
      ]}
    >
      {real ? (
        <BlurView
          style={StyleSheet.absoluteFill}
          intensity={intensity}
          tint="dark"
          blurTarget={target ?? undefined}
          blurMethod="dimezisBlurViewSdk31Plus"
        />
      ) : null}
      {/* Without real blur, use a denser fill so text stays readable. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: real ? tint : 'rgba(30,30,52,0.82)' }]} />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(255,255,255,0.12)', 'rgba(255,255,255,0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}
