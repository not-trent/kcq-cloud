import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassSurface } from '@/components/glass/GlassSurface';
import { DOCK, colors, radius, spacing } from '@/theme/tokens';

type IconName = keyof typeof Ionicons.glyphMap;

const ICONS: Record<string, { active: IconName; inactive: IconName }> = {
  index: { active: 'home', inactive: 'home-outline' },
  search: { active: 'search', inactive: 'search-outline' },
  recognise: { active: 'mic', inactive: 'mic-outline' },
  downloads: { active: 'arrow-down-circle', inactive: 'arrow-down-circle-outline' },
  library: { active: 'library', inactive: 'library-outline' },
};

/** Bottom padding a scrolling screen needs so content clears the floating dock. */
export function useDockSpace(): number {
  const insets = useSafeAreaInsets();
  return DOCK.height + Math.max(insets.bottom, spacing.md) + spacing.xl;
}

export function GlassDock({ state, descriptors, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, spacing.md) }]} pointerEvents="box-none">
      <GlassSurface radius={DOCK.radius} intensity={65} style={styles.dock}>
        <View style={styles.row}>
          {state.routes.map((route, index) => {
            const focused = state.index === index;
            const { options } = descriptors[route.key];
            const label = typeof options.title === 'string' ? options.title : route.name;
            const icons = ICONS[route.name] ?? { active: 'ellipse', inactive: 'ellipse-outline' };

            return (
              <Pressable
                key={route.key}
                accessibilityRole="tab"
                accessibilityLabel={label}
                accessibilityState={focused ? { selected: true } : {}}
                onPress={() => navigateToTab(route.key)}
                style={styles.item}
              >
                <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
                  <Ionicons
                    name={focused ? icons.active : icons.inactive}
                    size={22}
                    color={focused ? colors.text : colors.textMuted}
                  />
                </View>
                <Text style={[styles.label, focused && styles.labelActive]} numberOfLines={1}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: DOCK.margin,
    right: DOCK.margin,
    bottom: 0,
  },
  dock: {
    height: DOCK.height,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: '100%',
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  iconWrap: {
    paddingHorizontal: spacing.md,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  iconWrapActive: {
    backgroundColor: colors.glassStrong,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
  },
  labelActive: {
    color: colors.text,
  },
});
