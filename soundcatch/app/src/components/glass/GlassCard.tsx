import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { spacing } from '@/theme/tokens';
import { GlassSurface, type GlassSurfaceProps } from './GlassSurface';

export function GlassCard({
  children,
  style,
  padding = spacing.lg,
  ...rest
}: GlassSurfaceProps & { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <GlassSurface padding={padding} style={style} {...rest}>
      {children}
    </GlassSurface>
  );
}
