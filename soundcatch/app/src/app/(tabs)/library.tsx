import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState } from '@/components/EmptyState';
import { GlassCard } from '@/components/glass/GlassCard';
import { useDockSpace } from '@/components/GlassDock';
import { ScreenHeader } from '@/components/ScreenHeader';
import { TrackRow } from '@/components/TrackRow';
import { formatBytes } from '@/lib/format';
import { library, totalDownloadBytes, trackKey, useLibrary } from '@/store/library';
import { colors, radius, spacing } from '@/theme/tokens';

export default function LibraryScreen() {
  const dockSpace = useDockSpace();
  const { favourites, history, downloads, recentSearches } = useLibrary();
  const saved = downloads.filter((item) => item.status === 'complete');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: dockSpace }}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          title="Library"
          subtitle={`${favourites.length} favourite${favourites.length === 1 ? '' : 's'} · ${saved.length} saved`}
        />

        <GlassCard padding={spacing.lg} style={styles.storageCard}>
          <View style={styles.storageRow}>
            <View style={styles.storageIcon}>
              <Ionicons name="folder-open-outline" size={20} color={colors.secondary} />
            </View>
            <View style={styles.storageText}>
              <Text style={styles.storageTitle}>On this device</Text>
              <Text style={styles.storageMeta}>
                {saved.length === 0
                  ? 'No downloads stored yet'
                  : `${saved.length} track${saved.length === 1 ? '' : 's'} · ${formatBytes(totalDownloadBytes()) || 'size pending'}`}
              </Text>
            </View>
            <Pressable onPress={() => router.push('/downloads')} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.link}>Open</Text>
            </Pressable>
          </View>
        </GlassCard>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Favourites</Text>
          {favourites.length === 0 ? (
            <EmptyState
              icon="heart-outline"
              title="No favourites yet"
              message="Tap the heart on a track to keep it here, even before you download it."
              actionLabel="Find music"
              onAction={() => router.push('/search')}
            />
          ) : (
            favourites.map((track) => (
              <TrackRow
                key={trackKey(track)}
                track={track}
                onPress={() =>
                  router.push({
                    pathname: '/track/[provider]/[id]',
                    params: { provider: track.provider, id: track.id },
                  })
                }
              />
            ))
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Recognitions</Text>
            {history.length > 0 ? (
              <Pressable onPress={() => library.clearHistory()} accessibilityRole="button" hitSlop={8}>
                <Text style={styles.link}>Clear</Text>
              </Pressable>
            ) : null}
          </View>
          {history.length === 0 ? (
            <Text style={styles.note}>
              Matches from the microphone will appear here once a recognition provider is connected.
            </Text>
          ) : (
            history.map((track) => (
              <TrackRow
                key={trackKey(track)}
                track={track}
                onPress={() =>
                  router.push({
                    pathname: '/track/[provider]/[id]',
                    params: { provider: track.provider, id: track.id },
                  })
                }
              />
            ))
          )}
        </View>

        {recentSearches.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Recent searches</Text>
              <Pressable onPress={() => library.clearRecentSearches()} accessibilityRole="button" hitSlop={8}>
                <Text style={styles.link}>Clear</Text>
              </Pressable>
            </View>
            <View style={styles.chips}>
              {recentSearches.map((query) => (
                <View key={query} style={styles.chip}>
                  <Text style={styles.chipLabel} numberOfLines={1}>
                    {query}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  storageCard: {
    marginTop: spacing.xs,
  },
  storageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  storageIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass,
  },
  storageText: {
    flex: 1,
    gap: 2,
  },
  storageTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  storageMeta: {
    fontSize: 12,
    color: colors.textMuted,
  },
  link: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.secondary,
  },
  section: {
    marginTop: spacing.xl,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  note: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
    paddingVertical: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    maxWidth: '100%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  chipLabel: {
    fontSize: 13,
    color: colors.text,
  },
});
