import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, gradients, MIN_TOUCH, radius } from '@/theme/tokens';

interface Props {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'glass' | 'danger';
  icon?: string;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

export function GlassButton({ label, onPress, variant = 'glass', icon, loading, disabled, style, accessibilityHint }: Props) {
  const inactive = disabled || loading;
  const content = (
    <View style={styles.row}>
      {loading ? <ActivityIndicator color={colors.text} size="small" /> : icon ? <Text style={styles.icon}>{icon}</Text> : null}
      <Text style={[styles.label, variant === 'danger' && { color: colors.danger }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.();
      }}
      style={({ pressed }) => [styles.base, { opacity: inactive ? 0.45 : pressed ? 0.85 : 1 }, style]}
    >
      {variant === 'primary' ? (
        <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fill}>
          {content}
        </LinearGradient>
      ) : (
        <View style={[styles.fill, styles.glass, variant === 'danger' && { borderColor: 'rgba(248,113,113,0.5)' }]}>{content}</View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: MIN_TOUCH, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { minHeight: MIN_TOUCH, paddingHorizontal: 20, justifyContent: 'center', alignItems: 'center' },
  glass: { backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder, borderRadius: radius.pill },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  icon: { fontSize: 16, color: colors.text },
  label: { color: colors.text, fontSize: 15, fontWeight: '600' },
});
