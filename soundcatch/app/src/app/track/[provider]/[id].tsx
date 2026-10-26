import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassButton } from '@/components/glass/GlassButton';
import { GlassCard } from '@/components/glass/GlassCard';
import { api, type Track } from '@/lib/api';
import { downloadTrack } from '@/lib/downloads';
import { formatDuration, formatLicence, formatYear } from '@/lib/format';
import { library, trackKey, useLibrary } from '@/store/library';
import { colors, gradients, radius, spacing, type } from '@/theme/tokens';

const KIND_LABEL: Record<Track['kind'], string> = {
  song: 'Song',
  remix: 'Remix',
  mix: 'Mix',
  other: 'Track',
};

export default function TrackScreen() {
  const { provider, id } = useLocalSearchParams<{ provider: string; id: string }>();
  const insets = useSafeAreaInsets();
  const { downloads, favourites } = useLibrary();

  const [track, setTrack] = useState<Track | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!provider || !id) return;
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api
      .track(provider, id, controller.signal)
      .then((next) => {
        if (!active) return;
        setTrack(next);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : 'The track could not be loaded.');
        setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [provider, id, attempt]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/search'));

  if (loading) {
    return (
      <View style={[styles.safe, styles.centered]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (error || !track) {
    return (
      <View style={[styles.safe, styles.centered, { padding: spacing.xl }]}>
        <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
        <Text style={styles.errorTitle}>Track unavailable</Text>
        <Text style={styles.errorBody}>{error ?? 'The server did not return this track.'}</Text>
        <View style={styles.errorActions}>
          <GlassButton label="Try again" onPress={reload} variant="primary" />
          <GlassButton label="Back" onPress={back} variant="glass" />
        </View>
      </View>
    );
  }

  const key = trackKey(track);
  const record = downloads.find((item) => item.key === key);
  const favourite = favourites.some((item) => trackKey(item) === key);
  const downloadable = track.download.status === 'available';
  const downloading = record?.status === 'downloading';
  const complete = record?.status === 'complete';
  const failed = record?.status === 'failed';
  const licence = formatLicence(track.license);
  const year = formatYear(track.releaseYear);

  return (
    <View style={styles.safe}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          {track.artworkUrl ? (
            <Image source={{ uri: track.artworkUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={250} />
          ) : (
            <LinearGradient colors={gradients.accent} style={StyleSheet.absoluteFill} />
          )}
          <LinearGradient
            colors={['rgba(11,11,22,0.15)', 'rgba(11,11,22,0.85)', colors.bg]}
            locations={[0, 0.62, 1]}
            style={StyleSheet.absoluteFill}
          />

          <View style={[styles.heroTop, { paddingTop: insets.top + spacing.sm }]}>
            <Pressable onPress={back} accessibilityRole="button" accessibilityLabel="Go back" style={styles.roundButton}>
              <Ionicons name="chevron-back" size={22} color={colors.text} />
            </Pressable>
            <Pressable
              onPress={() => library.toggleFavourite(track)}
              accessibilityRole="button"
              accessibilityLabel={favourite ? 'Remove from favourites' : 'Add to favourites'}
              accessibilityState={{ selected: favourite }}
              style={styles.roundButton}
            >
              <Ionicons name={favourite ? 'heart' : 'heart-outline'} size={22} color={favourite ? colors.highlight : colors.text} />
            </Pressable>
          </View>

          <View style={styles.heroText}>
            <Text style={styles.title}>{track.title}</Text>
            <Text style={styles.artist}>{track.artist}</Text>
            <View style={styles.chips}>
              <Chip label={KIND_LABEL[track.kind]} />
              <Chip label={formatDuration(track.durationMs)} />
              {year ? <Chip label={year} /> : null}
              {track.genre ? <Chip label={track.genre} /> : null}
            </View>
          </View>
        </View>

        <View style={styles.content}>
          <GlassCard padding={spacing.lg}>
            <View style={styles.cardHead}>
              <Ionicons
                name={downloadable ? 'arrow-down-circle' : 'lock-closed'}
                size={18}
                color={downloadable ? colors.success : colors.warning}
              />
              <Text style={styles.cardTitle}>{downloadable ? 'Download' : 'Not downloadable'}</Text>
            </View>

            <Text style={styles.cardBody}>
              {track.download.status === 'available'
                ? 'The creator enabled downloads for this track. The original file is served through the SoundCatch server and stored on this device.'
                : track.download.message}
            </Text>

            {licence ? <Text style={styles.licence}>Licence: {licence}</Text> : null}

            {downloading ? (
              <View style={styles.progressBlock}>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${Math.max(4, Math.round((record?.progress ?? 0) * 100))}%` }]} />
                </View>
                <Text style={styles.progressLabel}>Downloading… {Math.round((record?.progress ?? 0) * 100)}%</Text>
              </View>
            ) : null}

            {failed && record?.error ? <Text style={styles.errorText}>{record.error}</Text> : null}

            <View style={styles.actions}>
              {downloadable && !complete ? (
                <GlassButton
                  label={failed ? 'Try download again' : 'Download original'}
                  onPress={() => void downloadTrack(track, 'original')}
                  variant="primary"
                  loading={downloading}
                  disabled={downloading}
                  style={styles.action}
                />
              ) : null}

              {downloadable && !complete && track.conversion.available ? (
                <GlassButton
                  label="Download as MP3"
                  onPress={() => void downloadTrack(track, 'mp3')}
                  variant="glass"
                  disabled={downloading}
                  style={styles.action}
                />
              ) : null}

              {complete ? (
                <>
                  <GlassButton label="Saved · open downloads" onPress={() => router.push('/downloads')} variant="primary" style={styles.action} />
                  <GlassButton label="Download again" onPress={() => void downloadTrack(track, 'original')} variant="glass" style={styles.action} />
                </>
              ) : null}

              {!downloadable ? (
                <GlassButton
                  label="Open on SoundCloud"
                  onPress={() => void Linking.openURL(track.permalinkUrl)}
                  variant="glass"
                  style={styles.action}
                />
              ) : null}
            </View>

            {downloadable && !track.conversion.available ? (
              <Text style={styles.conversionNote}>{track.conversion.message}</Text>
            ) : null}
          </GlassCard>

          <GlassCard padding={spacing.lg} style={styles.details}>
            <Text style={styles.cardTitle}>Details</Text>
            <DetailRow label="Source" value={track.attribution.providerName} />
            <DetailRow label="Duration" value={formatDuration(track.durationMs)} />
            <DetailRow label="Type" value={KIND_LABEL[track.kind]} />
            {year ? <DetailRow label="Year" value={year} /> : null}
            {track.genre ? <DetailRow label="Genre" value={track.genre} /> : null}
            {licence ? <DetailRow label="Licence" value={licence} /> : null}
            {track.isrc ? <DetailRow label="ISRC" value={track.isrc} /> : null}
            <DetailRow label="Track ID" value={track.id} />
          </GlassCard>

          <View style={styles.attribution}>
            <Text style={styles.attributionText}>
              Track data and audio come from {track.attribution.providerName}. SoundCatch only downloads tracks whose
              creator has enabled it.
            </Text>
            <View style={styles.attributionLinks}>
              <Pressable onPress={() => void Linking.openURL(track.permalinkUrl)} accessibilityRole="link" hitSlop={8}>
                <Text style={styles.attributionLink}>View on {track.attribution.providerName}</Text>
              </Pressable>
              {track.attribution.creatorUrl ? (
                <Pressable onPress={() => void Linking.openURL(track.attribution.creatorUrl!)} accessibilityRole="link" hitSlop={8}>
                  <Text style={styles.attributionLink}>Creator</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipLabel}>{label}</Text>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  hero: {
    height: 430,
    justifyContent: 'flex-end',
  },
  heroTop: {
    position: 'absolute',
    top: 0,
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  roundButton: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,8,20,0.55)',
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  heroText: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.xs,
  },
  title: {
    ...type.title,
    fontSize: 26,
  },
  artist: {
    fontSize: 15,
    color: 'rgba(248,250,252,0.8)',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  chipLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  content: {
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  cardBody: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
  },
  licence: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: colors.textMuted,
  },
  progressBlock: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  progressLabel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  errorText: {
    marginTop: spacing.sm,
    fontSize: 12,
    lineHeight: 18,
    color: colors.danger,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  action: {
    minWidth: 180,
  },
  conversionNote: {
    marginTop: spacing.md,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
  details: {
    gap: 2,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.glassBorder,
  },
  detailLabel: {
    fontSize: 13,
    color: colors.textMuted,
  },
  detailValue: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'right',
  },
  attribution: {
    paddingHorizontal: spacing.xs,
    gap: spacing.sm,
  },
  attributionText: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
  attributionLinks: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  attributionLink: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.secondary,
  },
  errorTitle: {
    ...type.heading,
  },
  errorBody: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
    textAlign: 'center',
  },
  errorActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});
