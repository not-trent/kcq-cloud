import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Track } from '@/lib/api';
import { formatDuration } from '@/lib/format';
import { colors, radius, spacing } from '@/theme/tokens';

const KIND_LABEL: Record<Track['kind'], string> = {
  song: 'Song',
  remix: 'Remix',
  mix: 'Mix',
  other: 'Track',
};

interface TrackRowProps {
  track: Track;
  onPress?: () => void;
  /** Rendered at the trailing edge, e.g. a play or download button. */
  right?: ReactNode;
  /** Overrides the duration line, e.g. a saved file size. */
  meta?: string;
}

export function TrackRow({ track, onPress, right, meta }: TrackRowProps) {
  const downloadable = track.download.status === 'available';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${track.title} by ${track.artist}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {track.artworkUrl ? (
        <Image source={{ uri: track.artworkUrl }} style={styles.art} contentFit="cover" transition={180} />
      ) : (
        <View style={[styles.art, styles.artFallback]}>
          <Ionicons name="musical-notes" size={20} color={colors.textMuted} />
        </View>
      )}

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {track.title}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {track.artist}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta} numberOfLines={1}>
            {meta ?? `${KIND_LABEL[track.kind]} · ${formatDuration(track.durationMs)}`}
          </Text>
          {downloadable ? (
            <View style={styles.downloadDot} accessibilityLabel="Downloadable" />
          ) : null}
        </View>
      </View>

      {right ? <View style={styles.right}>{right}</View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
  art: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
    backgroundColor: colors.bgAlt,
  },
  artFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  artist: {
    fontSize: 13,
    color: colors.textMuted,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  meta: {
    fontSize: 12,
    color: colors.textMuted,
    flexShrink: 1,
  },
  downloadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
  },
  right: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
