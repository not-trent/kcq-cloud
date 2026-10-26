import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState } from '@/components/EmptyState';
import { GlassCard } from '@/components/glass/GlassCard';
import { useDockSpace } from '@/components/GlassDock';
import { ScreenHeader } from '@/components/ScreenHeader';
import { downloadTrack } from '@/lib/downloads';
import { formatBytes } from '@/lib/format';
import { library, totalDownloadBytes, useLibrary, type DownloadRecord } from '@/store/library';
import { colors, radius, spacing } from '@/theme/tokens';

export default function DownloadsScreen() {
  const dockSpace = useDockSpace();
  const { downloads } = useLibrary();
  const player = useAudioPlayer();
  const status = useAudioPlayerStatus(player);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  useEffect(() => {
    if (activeKey && status.didJustFinish) setActiveKey(null);
  }, [activeKey, status.didJustFinish]);

  const toggle = (record: DownloadRecord) => {
    if (!record.fileUri) return;
    if (activeKey === record.key) {
      if (status.playing) player.pause();
      else player.play();
      return;
    }
    player.replace({ uri: record.fileUri });
    player.play();
    setActiveKey(record.key);
  };

  const share = async (record: DownloadRecord) => {
    if (!record.fileUri) return;
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Sharing unavailable', 'This device cannot share files.');
        return;
      }
      await Sharing.shareAsync(record.fileUri, {
        mimeType: 'audio/*',
        dialogTitle: `Share ${record.track.title}`,
      });
    } catch {
      Alert.alert('Could not share', 'The file could not be handed to another app.');
    }
  };

  const remove = (record: DownloadRecord) => {
    Alert.alert('Delete download', `Remove “${record.track.title}” from this device?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          if (activeKey === record.key) {
            player.pause();
            setActiveKey(null);
          }
          library.removeDownload(record.key);
        },
      },
    ]);
  };

  const saved = downloads.filter((item) => item.status === 'complete');
  const totalBytes = totalDownloadBytes();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: dockSpace }}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          title="Downloads"
          subtitle={
            saved.length === 0
              ? 'Keep creator-enabled tracks on this device.'
              : `${saved.length} track${saved.length === 1 ? '' : 's'} · ${formatBytes(totalBytes) || 'size pending'}`
          }
        />

        {downloads.length === 0 ? (
          <EmptyState
            icon="arrow-down-circle-outline"
            title="Nothing downloaded yet"
            message="Search the catalogue and download a track whose creator has enabled it. SoundCatch never works around that setting."
            actionLabel="Find music"
            onAction={() => router.push('/search')}
          />
        ) : (
          downloads.map((record) => (
            <DownloadCard
              key={record.key}
              record={record}
              playing={activeKey === record.key && status.playing}
              onToggle={() => toggle(record)}
              onShare={() => void share(record)}
              onRemove={() => remove(record)}
              onRetry={() => void downloadTrack(record.track)}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

interface DownloadCardProps {
  record: DownloadRecord;
  playing: boolean;
  onToggle: () => void;
  onShare: () => void;
  onRemove: () => void;
  onRetry: () => void;
}

function DownloadCard({ record, playing, onToggle, onShare, onRemove, onRetry }: DownloadCardProps) {
  const { track } = record;
  const downloading = record.status === 'downloading';
  const failed = record.status === 'failed';

  return (
    <GlassCard padding={spacing.md} style={styles.card}>
      <View style={styles.row}>
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
          <Text style={styles.meta} numberOfLines={1}>
            {downloading
              ? `Downloading… ${Math.round(record.progress * 100)}%`
              : failed
                ? 'Download failed'
                : `${formatBytes(record.sizeBytes) || 'Saved'}${record.downloadedAt ? ` · ${new Date(record.downloadedAt).toLocaleDateString()}` : ''}`}
          </Text>
        </View>

        {record.status === 'complete' ? (
          <Pressable
            onPress={onToggle}
            accessibilityRole="button"
            accessibilityLabel={playing ? `Pause ${track.title}` : `Play ${track.title}`}
            style={styles.playButton}
          >
            <Ionicons name={playing ? 'pause' : 'play'} size={20} color={colors.text} />
          </Pressable>
        ) : (
          <View style={styles.playButton}>
            {downloading ? <ActivityIndicator size="small" color={colors.text} /> : <Ionicons name="alert-circle" size={20} color={colors.danger} />}
          </View>
        )}
      </View>

      {downloading ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.max(4, Math.round(record.progress * 100))}%` }]} />
        </View>
      ) : null}

      {failed && record.error ? <Text style={styles.error}>{record.error}</Text> : null}

      <View style={styles.actions}>
        {failed ? (
          <CardAction icon="refresh" label="Retry" onPress={onRetry} />
        ) : (
          <CardAction icon="share-outline" label="Share" onPress={onShare} disabled={record.status !== 'complete'} />
        )}
        <CardAction icon="trash-outline" label="Delete" onPress={onRemove} disabled={downloading} />
      </View>
    </GlassCard>
  );
}

function CardAction({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.action, pressed && styles.actionPressed, disabled && styles.actionDisabled]}
    >
      <Ionicons name={icon} size={16} color={colors.text} />
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  card: {
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  art: {
    width: 58,
    height: 58,
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
  meta: {
    fontSize: 12,
    color: colors.textMuted,
  },
  playButton: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glassStrong,
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
  error: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.danger,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  actionPressed: {
    opacity: 0.7,
  },
  actionDisabled: {
    opacity: 0.4,
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
});
