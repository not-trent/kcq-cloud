import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GlassCard } from '@/components/glass/GlassCard';
import { useDockSpace } from '@/components/GlassDock';
import { ScreenHeader } from '@/components/ScreenHeader';
import { TrackRow } from '@/components/TrackRow';
import { useServerInfo } from '@/hooks/useServerInfo';
import { formatBytes } from '@/lib/format';
import { useLibrary } from '@/store/library';
import { colors, gradients, radius, spacing, type } from '@/theme/tokens';

export default function HomeScreen() {
  const dockSpace = useDockSpace();
  const server = useServerInfo();
  const { downloads, favourites } = useLibrary();
  const [link, setLink] = useState('');

  const recent = downloads.filter((item) => item.status === 'complete').slice(0, 3);

  const openLink = () => {
    const value = link.trim();
    if (!value) return;
    router.push({ pathname: '/search', params: { q: value } });
    setLink('');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: dockSpace }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeader title="SoundCatch" subtitle="Recognise, find and keep the music around you." />

        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor:
                  server.status === 'online'
                    ? server.soundcloudConfigured
                      ? colors.success
                      : colors.warning
                    : server.status === 'checking'
                      ? colors.textMuted
                      : colors.danger,
              },
            ]}
          />
          <Text style={styles.statusText} numberOfLines={1}>
            {server.status === 'checking'
              ? 'Checking the server…'
              : server.status === 'unreachable'
                ? 'Server unreachable'
                : server.soundcloudConfigured
                  ? 'Server online · SoundCloud ready'
                  : 'Server online · SoundCloud credentials missing'}
          </Text>
          {server.status === 'unreachable' ? (
            <Pressable onPress={server.reload} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.retry}>Retry</Text>
            </Pressable>
          ) : null}
        </View>

        <Pressable
          onPress={() => router.push('/recognise')}
          accessibilityRole="button"
          accessibilityLabel="Recognise a song"
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          <LinearGradient colors={gradients.accent} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
            <View style={styles.heroIcon}>
              <Ionicons name="mic" size={24} color={colors.text} />
            </View>
            <Text style={styles.heroTitle}>Hear something you like?</Text>
            <Text style={styles.heroBody}>Open the microphone and identify the track playing around you.</Text>
            <View style={styles.heroCta}>
              <Text style={styles.heroCtaLabel}>Recognise now</Text>
              <Ionicons name="arrow-forward" size={16} color={colors.text} />
            </View>
          </LinearGradient>
        </Pressable>

        <View style={styles.quickRow}>
          <Pressable
            onPress={() => router.push('/search')}
            accessibilityRole="button"
            style={({ pressed }) => [styles.quickTile, pressed && styles.pressed]}
          >
            <Ionicons name="search" size={20} color={colors.secondary} />
            <Text style={styles.quickLabel}>Search</Text>
            <Text style={styles.quickHint}>SoundCloud catalogue</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/downloads')}
            accessibilityRole="button"
            style={({ pressed }) => [styles.quickTile, pressed && styles.pressed]}
          >
            <Ionicons name="arrow-down-circle" size={20} color={colors.primary} />
            <Text style={styles.quickLabel}>Downloads</Text>
            <Text style={styles.quickHint}>
              {downloads.length === 0 ? 'Nothing saved yet' : `${downloads.length} saved`}
            </Text>
          </Pressable>
        </View>

        <GlassCard padding={spacing.lg} style={styles.card}>
          <Text style={styles.cardTitle}>Have a link?</Text>
          <Text style={styles.cardBody}>Paste a SoundCloud track URL to fetch its details and download options.</Text>
          <View style={styles.inputRow}>
            <TextInput
              value={link}
              onChangeText={setLink}
              placeholder="https://soundcloud.com/artist/track"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={openLink}
              accessibilityLabel="SoundCloud track link"
            />
            <Pressable
              onPress={openLink}
              accessibilityRole="button"
              accessibilityLabel="Open link"
              style={[styles.goButton, !link.trim() && styles.goButtonDisabled]}
              disabled={!link.trim()}
            >
              <Ionicons name="arrow-forward" size={18} color={colors.text} />
            </Pressable>
          </View>
        </GlassCard>

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Recently saved</Text>
            {downloads.length > 0 ? (
              <Pressable onPress={() => router.push('/downloads')} accessibilityRole="button" hitSlop={8}>
                <Text style={styles.sectionLink}>See all</Text>
              </Pressable>
            ) : null}
          </View>

          {recent.length === 0 ? (
            <Text style={styles.emptyText}>
              {favourites.length > 0
                ? 'Downloads you keep will show up here.'
                : 'Downloads and favourites will show up here once you start collecting.'}
            </Text>
          ) : (
            recent.map((record) => (
              <TrackRow
                key={record.key}
                track={record.track}
                meta={`Saved · ${formatBytes(record.sizeBytes) || 'audio'}`}
                onPress={() => router.push('/downloads')}
              />
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  pressed: {
    opacity: 0.85,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusText: {
    flexShrink: 1,
    fontSize: 12,
    color: colors.textMuted,
  },
  retry: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.secondary,
  },
  hero: {
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  heroIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: spacing.xs,
  },
  heroTitle: {
    ...type.heading,
    fontSize: 22,
  },
  heroBody: {
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(248,250,252,0.86)',
  },
  heroCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  heroCtaLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  quickRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  quickTile: {
    flex: 1,
    gap: 4,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  quickLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  quickHint: {
    fontSize: 12,
    color: colors.textMuted,
  },
  card: {
    marginTop: spacing.lg,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  cardBody: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  input: {
    flex: 1,
    height: 46,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(8,8,20,0.55)',
    borderWidth: 1,
    borderColor: colors.glassBorder,
    color: colors.text,
    fontSize: 14,
  },
  goButton: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  goButtonDisabled: {
    opacity: 0.4,
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
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  sectionLink: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.secondary,
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
    paddingVertical: spacing.md,
  },
});
