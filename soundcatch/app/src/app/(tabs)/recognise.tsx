import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useAudioPlayer } from 'expo-audio';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { Directory, File } from 'expo-file-system';
import { LinearGradient } from 'expo-linear-gradient';
import * as Sharing from 'expo-sharing';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GlassButton } from '@/components/glass/GlassButton';
import { GlassCard } from '@/components/glass/GlassCard';
import { useDockSpace } from '@/components/GlassDock';
import { ScreenHeader } from '@/components/ScreenHeader';
import { api, type RecogniseResult, type Track, type UnifiedTrack } from '@/lib/api';
import { downloadTrack, downloadsDirectory, exportFileToSharedDownloads } from '@/lib/downloads';
import { base64ToUint8, createZip, uint8ToBase64 } from '@/lib/zip';
import { rankDownloadCandidates, type RankedCandidate } from '@/lib/downloadMatching';
import { library, trackKey, useLibrary } from '@/store/library';
import { colors, gradients, radius, spacing, type as typeTokens } from '@/theme/tokens';

const LISTEN_SECONDS = 10;

type Phase = 'idle' | 'requesting' | 'recording' | 'processing' | 'result' | 'notfound' | 'error' | 'denied';

function inferMimeType(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.m4a')) return 'audio/m4a';
  if (lower.endsWith('.mp4')) return 'audio/mp4';
  if (lower.endsWith('.3gp')) return 'audio/3gpp';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.aac')) return 'audio/aac';
  return 'audio/m4a';
}

function toTrack(sc: UnifiedTrack): Track | null {
  if (!sc.provider || !sc.id) return null;
  return {
    provider: sc.provider,
    id: sc.id,
    title: sc.title,
    artist: sc.artist,
    album: sc.album,
    durationMs: sc.durationMs ?? 0,
    artworkUrl: sc.coverUrl,
    permalinkUrl: sc.sourceUrl ?? '',
    genre: sc.genre,
    releaseYear: sc.releaseYear,
    license: sc.license,
    isrc: sc.isrc,
    kind: 'song',
    download: sc.download ?? (sc.downloadable ? { status: 'available' } : { status: 'unavailable', reason: 'unknown', message: 'Not downloadable.' }),
    attribution: sc.attribution ?? { providerName: 'SoundCloud' },
    conversion: { available: false, message: 'MP3 conversion is decided by the server.' },
  };
}

function classificationLabel(value?: UnifiedTrack['classification']): string {
  switch (value) {
    case 'authorised_download':
      return 'Authorised Download';
    case 'purchase_required':
      return 'Purchase Required';
    case 'streaming_only':
      return 'Streaming Only';
    case 'download_rights_unverified':
      return 'Download Rights Unverified';
    case 'download_prohibited':
      return 'Download Prohibited';
    default:
      return 'Unclassified';
  }
}

function saveMatch(res: RecogniseResult): void {
  const sc = res.soundcloud;
  if (sc) {
    const track = toTrack(sc);
    if (track) { library.addHistory(track); return; }
  }
  library.addHistory({
    provider: 'recognised',
    id: `${res.title}-${res.artist}`.replace(/\s+/g, '-').toLowerCase(),
    title: res.title,
    artist: res.artist,
    durationMs: 0,
    artworkUrl: res.coverUrl,
    permalinkUrl: res.spotifyUrl || res.appleMusicUrl || res.match.songLink || '',
    kind: 'song',
    download: { status: 'unavailable', reason: 'unknown', message: 'Not downloadable.' },
    attribution: { providerName: 'AudD' },
    conversion: { available: false, message: 'Not available.' },
  });
}

export default function RecogniseScreen() {
  const dockSpace = useDockSpace();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);
  const player = useAudioPlayer();

  const [phase, setPhase] = useState<Phase>('idle');
  const [capturedSeconds, setCapturedSeconds] = useState(0);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [capturedMimeType, setCapturedMimeType] = useState('audio/m4a');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecogniseResult | null>(null);
  const [playing, setPlaying] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Download panels
  const [songPanelOpen, setSongPanelOpen] = useState(false);
  const [albumPanelOpen, setAlbumPanelOpen] = useState(false);
  const [candidates, setCandidates] = useState<RankedCandidate[]>([]);
  const [candidatePhase, setCandidatePhase] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [selectedTracks, setSelectedTracks] = useState<Record<string, boolean>>({});
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);

  const { downloads } = useLibrary();

  const pulse = useRef(new Animated.Value(0)).current;
  const sentRef = useRef(false);

  useEffect(() => {
    return () => {
      try { void recorder.stop(); } catch { /* ignore */ }
      void setAudioModeAsync({ allowsRecording: false });
    };
  }, [recorder]);

  useEffect(() => {
    if (phase !== 'recording') { pulse.setValue(0); return; }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [phase, pulse]);

  const sendClip = useCallback(async (uri: string, mime: string) => {
    setError(null);
    try {
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const res = await api.recognise(base64, mime);
      setResult(res);
      saveMatch(res);
      setPhase('result');
    } catch (cause: unknown) {
      if (cause instanceof Error && 'status' in cause) {
        const status = (cause as { status: number }).status;
        if (status === 404) { setPhase('notfound'); return; }
      }
      setError(cause instanceof Error ? cause.message : 'Recognition failed.');
      setPhase('error');
    } finally {
      // Always release the recorder session so the next attempt can prepare cleanly.
      try { await recorder.stop(); } catch { /* already stopped */ }
      void setAudioModeAsync({ allowsRecording: false });
    }
  }, [recorder]);

  useEffect(() => {
    if (phase !== 'recording') return;
    if (recorderState.isRecording || !recorderState.url) return;
    setCapturedSeconds(Math.max(1, Math.round(recorderState.durationMillis / 1000)));
    if (sentRef.current) return;
    sentRef.current = true;
    const uri = recorderState.url;
    const mime = inferMimeType(uri);
    setCapturedUri(uri);
    setCapturedMimeType(mime);
    setPhase('processing');
    void sendClip(uri, mime);
    void setAudioModeAsync({ allowsRecording: false });
  }, [phase, recorderState.isRecording, recorderState.url, recorderState.durationMillis, sendClip]);

  const startingRef = useRef(false);

  const start = async () => {
    if (startingRef.current || phase === 'requesting' || phase === 'recording' || phase === 'processing') return;
    startingRef.current = true;
    setError(null);
    setResult(null);
    sentRef.current = false;
    setPhase('requesting');
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) { setPhase('denied'); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      // Only prepare when the recorder is not already prepared/recording.
      if (recorder.isRecording) {
        try { await recorder.stop(); } catch { /* ignore */ }
      }
      const status = typeof recorder.getStatus === 'function' ? recorder.getStatus() : null;
      if (!status || !status.canRecord) {
        await recorder.prepareToRecordAsync();
      }
      recorder.record({ forDuration: LISTEN_SECONDS });
      setPhase('recording');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The microphone could not be started.');
      setPhase('error');
      void setAudioModeAsync({ allowsRecording: false });
    } finally {
      startingRef.current = false;
    }
  };

  const reset = () => {
    setCapturedSeconds(0);
    setError(null);
    setResult(null);
    setCapturedUri(null);
    sentRef.current = false;
    setPhase('idle');
    setPlaying(false);
    setSongPanelOpen(false);
    setAlbumPanelOpen(false);
    setCandidates([]);
    setCandidatePhase('idle');
    setCandidateError(null);
    setSelectedTracks({});
    // Release any prepared recorder session.
    try { void recorder.stop(); } catch { /* ignore */ }
    void setAudioModeAsync({ allowsRecording: false });
  };

  const retry = () => {
    if (!capturedUri) { reset(); return; }
    setPhase('processing');
    void sendClip(capturedUri, capturedMimeType);
  };

  const togglePreview = () => {
    if (!result?.previewUrl) return;
    if (playing) { player.pause(); setPlaying(false); }
    else { player.replace({ uri: result.previewUrl }); player.play(); setPlaying(true); }
  };

  const downloadResult = async () => {
    const sc = result?.soundcloud;
    const track = sc ? toTrack(sc) : null;
    if (!track) return;
    setDownloading(true);
    try { await downloadTrack(track, 'original'); }
    finally { setDownloading(false); }
  };

  const loadCandidates = useCallback(async () => {
    if (!result) return;
    setCandidatePhase('loading');
    setCandidateError(null);
    try {
      const page = await api.search(`${result.title} ${result.artist}`);
      const ranked = rankDownloadCandidates(page.items, result);
      setCandidates(ranked);
      const selection: Record<string, boolean> = {};
      ranked.forEach((item) => {
        const track = toTrack(item.track);
        if (track && item.track.downloadable) selection[trackKey(track)] = true;
      });
      setSelectedTracks(selection);
      setCandidatePhase('done');
    } catch (cause) {
      setCandidateError(cause instanceof Error ? cause.message : 'Search failed.');
      setCandidatePhase('error');
    }
  }, [result]);

  const openSongPanel = () => {
    setAlbumPanelOpen(false);
    setSongPanelOpen(true);
    if (candidates.length === 0 && candidatePhase !== 'loading') void loadCandidates();
  };

  const openAlbumPanel = () => {
    setSongPanelOpen(false);
    setAlbumPanelOpen(true);
    if (candidates.length === 0 && candidatePhase !== 'loading') void loadCandidates();
  };

  const closePanels = () => {
    setSongPanelOpen(false);
    setAlbumPanelOpen(false);
  };

  const candidateKey = (candidate: UnifiedTrack): string => {
    const track = toTrack(candidate);
    return track ? trackKey(track) : `${candidate.title}-${candidate.artist}`;
  };

  const downloadCandidate = async (candidate: UnifiedTrack) => {
    const track = toTrack(candidate);
    if (!track) {
      Alert.alert('Unavailable', 'This result cannot be downloaded.');
      return;
    }
    const key = trackKey(track);
    const existing = downloads.find((item) => item.key === key);
    if (existing?.status === 'complete') {
      Alert.alert('Already downloaded', 'This track is already in your downloads.');
      return;
    }
    setDownloadingKey(key);
    try {
      await downloadTrack(track, 'original', { metadata: true });
    } finally {
      setDownloadingKey(null);
    }
  };

  const downloadAlbumTracks = async (tracks: { candidate: UnifiedTrack; index: number }[]) => {
    if (!result) return;
    const artist = sanitizeFileName(result.artist || 'Unknown Artist');
    const album = sanitizeFileName(result.album || result.title || 'Album');
    const dir = new Directory(downloadsDirectory, artist, album);
    for (const { candidate, index } of tracks) {
      const track = toTrack(candidate);
      if (!track || track.download.status !== 'available') continue;
      const key = trackKey(track);
      setDownloadingKey(key);
      const ext = normaliseExtension(track.download.originalFormat);
      const fileName = `${String(index + 1).padStart(2, '0')} - ${sanitizeFileName(track.title)}${ext}`;
      await downloadTrack(track, 'original', { directory: dir, fileName, metadata: true });
    }
    setDownloadingKey(null);
  };

  const sanitizeFileName = (value: string): string => value.replace(/[<>:"/\\|?*]/g, '').trim() || 'track';

  const hasDownloadable = (items: RankedCandidate[]): boolean => items.some((item) => item.track.downloadable);

  const allTracksAvailable = (items: RankedCandidate[]): boolean =>
    items.length > 0 && items.every((item) => item.track.downloadable);

  const normaliseExtension = (format: string | undefined): string => {
    if (!format) return '.mp3';
    const cleaned = format.trim().toLowerCase();
    if (cleaned.startsWith('.')) return cleaned;
    if (cleaned === 'mp3') return '.mp3';
    if (cleaned === 'm4a' || cleaned === 'mp4') return '.m4a';
    if (cleaned === 'wav') return '.wav';
    if (cleaned === 'flac') return '.flac';
    if (cleaned === 'ogg') return '.ogg';
    return `.${cleaned}`;
  };

  const downloadAlbumZip = async () => {
    if (!result || zipping) return;
    const toZip = candidates
      .map((candidate, index) => ({ candidate: candidate.track, index }))
      .filter(({ candidate }) => {
        const track = toTrack(candidate);
        if (!track || track.download.status !== 'available') return false;
        const key = trackKey(track);
        const anySelected = Object.values(selectedTracks).some(Boolean);
        return anySelected ? !!selectedTracks[key] : true;
      });

    const missing = candidates
      .map((candidate) => candidate.track)
      .filter((candidate) => {
        const track = toTrack(candidate);
        return !track || track.download.status !== 'available';
      })
      .map((candidate) => candidate.title);

    if (toZip.length === 0) {
      Alert.alert('No tracks available', 'There are no authorised tracks to include in the ZIP.');
      return;
    }

    setZipping(true);
    try {
      const artist = sanitizeFileName(result.artist || 'Unknown Artist');
      const album = sanitizeFileName(result.album || result.title || 'Album');
      const tempDir = new Directory(downloadsDirectory, '.tmp', `${artist}-${album}`);
      if (!tempDir.exists) tempDir.create({ intermediates: true, idempotent: true });

      const fileEntries: { name: string; uri: string }[] = [];
      for (const { candidate, index } of toZip) {
        const track = toTrack(candidate);
        if (!track) continue;
        const key = trackKey(track);
        setDownloadingKey(key);
        const ext = normaliseExtension(track.download.status === 'available' ? track.download.originalFormat : undefined);
        const fileName = `${String(index + 1).padStart(2, '0')} - ${sanitizeFileName(track.title)}${ext}`;
        await downloadTrack(track, 'original', { directory: tempDir, fileName, metadata: true });
        fileEntries.push({ name: fileName, uri: new File(tempDir, fileName).uri });
      }
      setDownloadingKey(null);

      const entries: { name: string; data: Uint8Array }[] = [];
      const coverUrl = result.coverUrl || result.soundcloud?.coverUrl;
      if (coverUrl) {
        try {
          const response = await fetch(coverUrl);
          if (response.ok) {
            const buffer = await response.arrayBuffer();
            entries.push({ name: 'cover.jpg', data: new Uint8Array(buffer) });
          }
        } catch {
          // Best-effort cover art.
        }
      }

      for (const file of fileEntries) {
        const base64 = await FileSystem.readAsStringAsync(file.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        entries.push({ name: file.name, data: base64ToUint8(base64) });
      }

      const zipBytes = createZip(entries);
      const soundCatchDir = new Directory(downloadsDirectory, 'SoundCatch');
      if (!soundCatchDir.exists) soundCatchDir.create({ intermediates: true, idempotent: true });
      const zipName = `${artist} - ${album}.zip`;
      const zipFile = new File(soundCatchDir, zipName);
      await FileSystem.writeAsStringAsync(zipFile.uri, uint8ToBase64(zipBytes), {
        encoding: FileSystem.EncodingType.Base64,
      });

      const shared = await exportFileToSharedDownloads(zipFile);

      try {
        if (tempDir.exists) tempDir.delete();
      } catch {
        // Best-effort cleanup.
      }

      const location = shared ? 'Downloads/SoundCatch' : 'app storage';

      const shareZip = async () => {
        try {
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(zipFile.uri, { mimeType: 'application/zip', dialogTitle: zipName });
          }
        } catch {
          // Sharing is best-effort.
        }
      };

      if (missing.length > 0) {
        Alert.alert(
          'Album ZIP created',
          `Saved ${zipName} to ${location}. Missing/unavailable tracks: ${missing.join(', ')}.`,
          [{ text: 'Share', onPress: () => void shareZip() }, { text: 'OK' }],
        );
      } else {
        Alert.alert(
          'Album ZIP created',
          `Saved ${zipName} to ${location}.`,
          [{ text: 'Share', onPress: () => void shareZip() }, { text: 'OK' }],
        );
      }
    } catch (error) {
      Alert.alert('ZIP failed', error instanceof Error ? error.message : 'Could not create the album ZIP.');
    } finally {
      setZipping(false);
      setDownloadingKey(null);
    }
  };

  const elapsed = Math.min(LISTEN_SECONDS, Math.floor(recorderState.durationMillis / 1000));
  const recording = phase === 'recording';
  const releaseYear = result?.match.releaseDate?.slice(0, 4);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: dockSpace }} showsVerticalScrollIndicator={false}>
        <ScreenHeader title="Recognise" subtitle="Identify a song playing around you." />

        <View style={styles.stage}>
          <Animated.View
            style={[
              styles.pulseRing,
              {
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.45] }),
                transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }],
              },
            ]}
          />
          <Pressable
            onPress={phase === 'idle' || phase === 'error' || phase === 'notfound' || phase === 'result' ? start : undefined}
            disabled={phase === 'requesting' || phase === 'recording' || phase === 'processing' || phase === 'denied'}
            accessibilityRole="button"
            accessibilityLabel="Listen"
            style={({ pressed }) => [styles.micButton, recording && styles.micButtonActive, pressed && styles.micButtonPressed]}
          >
            <Ionicons name={recording ? 'stop' : 'mic'} size={52} color={colors.text} />
          </Pressable>
          <Text style={styles.stageTitle}>
            {phase === 'idle'
              ? 'Tap to listen'
              : phase === 'requesting'
              ? 'Preparing microphone�'
              : phase === 'recording'
              ? `Listening� ${LISTEN_SECONDS - elapsed}s`
              : phase === 'processing'
              ? 'Recognising�'
              : phase === 'denied'
              ? 'Microphone access denied'
              : phase === 'notfound'
              ? "Couldn't recognise it"
              : phase === 'error'
              ? 'Something went wrong'
              : 'Match found'}
          </Text>
          <Text style={styles.stageHint}>
            {phase === 'idle'
              ? 'Hold your phone near the music for 10 seconds.'
              : phase === 'recording'
              ? 'Keep the phone steady and pointed at the source.'
              : phase === 'denied'
              ? 'Enable microphone permission in system settings to use recognition.'
              : phase === 'processing'
              ? 'Sending the clip to the server.'
              : ''
          }
          </Text>
        </View>

        {phase === 'denied' ? (
          <GlassCard padding={spacing.lg} style={styles.card}>
            <View style={styles.cardHead}>
              <Ionicons name="mic-off" size={18} color={colors.warning} />
              <Text style={styles.cardTitle}>Microphone permission denied</Text>
            </View>
            <Text style={styles.cardBody}>SoundCatch needs microphone access to identify music. Grant it in your device settings, then try again.</Text>
            <GlassButton label="Try again" onPress={reset} variant="glass" style={styles.cardAction} />
          </GlassCard>
        ) : null}

        {phase === 'notfound' ? (
          <GlassCard padding={spacing.lg} style={styles.card}>
            <View style={styles.cardHead}>
              <Ionicons name="help-circle" size={18} color={colors.warning} />
              <Text style={styles.cardTitle}>Couldn't recognise it</Text>
            </View>
            <Text style={styles.cardBody}>No matching track was found for that clip. Try again in a quieter spot, or search by name.</Text>
            <View style={styles.cardActions}>
              <GlassButton label="Search instead" onPress={() => router.push('/search')} variant="primary" style={styles.cardAction} />
              <GlassButton label="Listen again" onPress={reset} variant="glass" style={styles.cardAction} />
            </View>
          </GlassCard>
        ) : null}

        {phase === 'error' ? (
          <GlassCard padding={spacing.lg} style={styles.card}>
            <View style={styles.cardHead}>
              <Ionicons name="alert-circle" size={18} color={colors.danger} />
              <Text style={styles.cardTitle}>Recognition failed</Text>
            </View>
            <Text style={styles.cardBody}>{error ?? 'The server could not process the clip.'}</Text>
            <View style={styles.cardActions}>
              <GlassButton label="Retry" onPress={retry} variant="primary" style={styles.cardAction} />
              <GlassButton label="Listen again" onPress={reset} variant="glass" style={styles.cardAction} />
            </View>
          </GlassCard>
        ) : null}

        {phase === 'result' && result ? (
          <GlassCard padding={spacing.lg} style={styles.card}>
            <View style={styles.resultHeader}>
              {result.coverUrl || result.soundcloud?.coverUrl ? (
                <Image source={{ uri: (result.coverUrl || result.soundcloud?.coverUrl) as string }} style={styles.cover} contentFit="cover" transition={200} />
              ) : (
                <View style={[styles.cover, styles.coverFallback]}>
                  <Ionicons name="musical-notes" size={28} color={colors.textMuted} />
                </View>
              )}
              <View style={styles.resultMeta}>
                <Text style={styles.resultTitle}>{result.title}</Text>
                <Text style={styles.resultArtist}>{result.artist}</Text>
                {result.album ? <Text style={styles.resultAlbum}>{result.album}</Text> : null}
                {releaseYear ? <Text style={styles.resultYear}>{releaseYear}</Text> : null}
              </View>
            </View>

            {result.previewUrl ? (
              <GlassButton
                label={playing ? 'Pause preview' : 'Play 30s preview'}
                onPress={togglePreview}
                variant="glass"
                style={styles.cardAction}
              />
            ) : null}

            <View style={styles.downloadButtons}>
              <Pressable onPress={openSongPanel} style={styles.downloadButton} accessibilityRole="button" accessibilityLabel="Download Song">
                <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.downloadButtonFill}>
                  <Ionicons name="download-outline" size={18} color={colors.text} />
                  <Text style={styles.downloadButtonLabel}>Download Song</Text>
                </LinearGradient>
              </Pressable>
              <Pressable onPress={openAlbumPanel} style={styles.downloadButton} accessibilityRole="button" accessibilityLabel="Download Album">
                <LinearGradient colors={gradients.accent} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.downloadButtonFill}>
                  <Ionicons name="albums-outline" size={18} color={colors.text} />
                  <Text style={styles.downloadButtonLabel}>Download Album</Text>
                </LinearGradient>
              </Pressable>
            </View>

            <View style={styles.actions}>
              {result.spotifyUrl ? (
                <GlassButton label="Open in Spotify" onPress={() => void Linking.openURL(result.spotifyUrl!)} variant="primary" style={styles.action} />
              ) : null}
              {result.appleMusicUrl ? (
                <GlassButton label="Open in Apple Music" onPress={() => void Linking.openURL(result.appleMusicUrl!)} variant="glass" style={styles.action} />
              ) : null}
              {result.soundcloud?.sourceUrl ? (
                <GlassButton label="Open in SoundCloud" onPress={() => void Linking.openURL(result.soundcloud!.sourceUrl!)} variant="glass" style={styles.action} />
              ) : null}
            </View>

            {songPanelOpen ? (
              <View style={styles.panel}>
                <View style={styles.panelHeader}>
                  <Text style={styles.panelTitle}>Download Song</Text>
                  <Pressable onPress={closePanels} accessibilityLabel="Close">
                    <Ionicons name="close" size={20} color={colors.textMuted} />
                  </Pressable>
                </View>
                <Text style={styles.panelBody}>
                  SoundCatch searches authorised sources for the recognised recording and ranks matches by artist, title, duration and version.
                </Text>
                {candidatePhase === 'loading' ? (
                  <View style={styles.panelLoading}>
                    <ActivityIndicator color={colors.primary} />
                    <Text style={styles.panelBody}>Searching authorised sources…</Text>
                  </View>
                ) : null}
                {candidatePhase === 'error' ? (
                  <Text style={styles.panelError}>{candidateError}</Text>
                ) : null}
                {candidatePhase === 'done' && candidates.length === 0 ? (
                  <Text style={styles.panelBody}>No matching recordings were found.</Text>
                ) : null}
                {candidates.map((item, index) => {
                  const track = toTrack(item.track);
                  const key = track ? trackKey(track) : item.track.title;
                  const record = track ? downloads.find((d) => d.key === key) : undefined;
                  const isDownloading = downloadingKey === key || record?.status === 'downloading';
                  const isComplete = record?.status === 'complete';
                  return (
                    <View key={key} style={styles.candidateRow}>
                      {item.track.coverUrl ? (
                        <Image source={{ uri: item.track.coverUrl }} style={styles.candidateCover} contentFit="cover" />
                      ) : (
                        <View style={[styles.candidateCover, styles.coverFallback]}>
                          <Ionicons name="musical-notes" size={16} color={colors.textMuted} />
                        </View>
                      )}
                      <View style={styles.candidateMeta}>
                        <Text style={styles.candidateTitle} numberOfLines={1}>{item.track.title}</Text>
                        <Text style={styles.candidateArtist} numberOfLines={1}>{item.track.artist}</Text>
                        <Text style={styles.candidateDetail} numberOfLines={2}>
                          {item.track.sourceName ?? item.track.source}
                          {item.track.format ? ` · ${item.track.format}` : ''}
                          {item.track.classification ? ` · ${classificationLabel(item.track.classification)}` : ''}
                          {index === 0 ? ' · Best match' : ''}
                        </Text>
                        {item.confidence === 'low' && index === 0 ? (
                          <Text style={styles.panelWarning}>Low confidence — please confirm this is the right recording.</Text>
                        ) : null}
                        {item.reasons.length > 0 ? (
                          <Text style={styles.candidateReasons} numberOfLines={2}>{item.reasons.join(' · ')}</Text>
                        ) : null}
                        {record?.status === 'downloading' ? (
                          <View style={styles.progressTrack}>
                            <View style={[styles.progressFill, { width: `${Math.max(4, Math.round((record.progress ?? 0) * 100))}%` }]} />
                          </View>
                        ) : null}
                        {record?.status === 'failed' && record.error ? (
                          <Text style={styles.panelError}>{record.error}</Text>
                        ) : null}
                      </View>
                      <View style={styles.candidateActions}>
                        {item.track.downloadable ? (
                          <GlassButton
                            label={isComplete ? 'Downloaded' : isDownloading ? 'Downloading…' : 'Download'}
                            onPress={() => void downloadCandidate(item.track)}
                            variant="primary"
                            loading={isDownloading}
                            disabled={isDownloading || isComplete}
                            style={styles.candidateButton}
                          />
                        ) : (
                          <GlassButton
                            label="Open source"
                            onPress={() => {
                              if (item.track.sourceUrl) void Linking.openURL(item.track.sourceUrl);
                            }}
                            variant="glass"
                            style={styles.candidateButton}
                          />
                        )}
                      </View>
                    </View>
                  );
                })}
                {!hasDownloadable(candidates) && candidates.length > 0 ? (
                  <View style={styles.panelNote}>
                    <Ionicons name="information-circle-outline" size={16} color={colors.warning} />
                    <Text style={styles.panelBody}>
                      No authorised download is available for this recording. Use the listening or purchase links above.
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {albumPanelOpen ? (
              <View style={styles.panel}>
                <View style={styles.panelHeader}>
                  <Text style={styles.panelTitle}>Download Album</Text>
                  <Pressable onPress={closePanels} accessibilityLabel="Close">
                    <Ionicons name="close" size={20} color={colors.textMuted} />
                  </Pressable>
                </View>
                <View style={styles.albumHeader}>
                  {result.coverUrl ? (
                    <Image source={{ uri: result.coverUrl }} style={styles.albumCover} contentFit="cover" />
                  ) : (
                    <View style={[styles.albumCover, styles.coverFallback]}>
                      <Ionicons name="albums" size={24} color={colors.textMuted} />
                    </View>
                  )}
                  <View style={styles.albumMeta}>
                    <Text style={styles.albumTitle}>{result.album || result.title}</Text>
                    <Text style={styles.albumArtist}>{result.artist}</Text>
                    {releaseYear ? <Text style={styles.albumYear}>{releaseYear}</Text> : null}
                    <Text style={styles.albumTracks}>{candidates.length} track{candidates.length === 1 ? '' : 's'} found</Text>
                  </View>
                </View>
                {candidatePhase === 'loading' ? (
                  <View style={styles.panelLoading}>
                    <ActivityIndicator color={colors.primary} />
                    <Text style={styles.panelBody}>Searching authorised sources…</Text>
                  </View>
                ) : null}
                {candidatePhase === 'error' ? (
                  <Text style={styles.panelError}>{candidateError}</Text>
                ) : null}
                {candidates.map((item, index) => {
                  const track = toTrack(item.track);
                  const key = track ? trackKey(track) : item.track.title;
                  const checked = !!selectedTracks[key];
                  const available = item.track.downloadable;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => {
                        if (!available) return;
                        setSelectedTracks((prev) => ({ ...prev, [key]: !prev[key] }));
                      }}
                      style={styles.albumTrackRow}
                    >
                      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                        {checked ? <Ionicons name="checkmark" size={14} color={colors.text} /> : null}
                      </View>
                      <View style={styles.albumTrackMeta}>
                        <Text style={styles.albumTrackTitle} numberOfLines={1}>
                          {String(index + 1).padStart(2, '0')} · {item.track.title}
                        </Text>
                        <Text style={styles.albumTrackArtist} numberOfLines={1}>{item.track.artist}</Text>
                      </View>
                      <Text style={[styles.availabilityBadge, available ? styles.available : styles.unavailable]}>
                        {available ? 'Available' : 'Unavailable'}
                      </Text>
                    </Pressable>
                  );
                })}
                <View style={styles.albumActions}>
                  <GlassButton
                    label="Download available tracks"
                    onPress={() => {
                      const toDownload = candidates
                        .map((candidate, index) => ({ candidate: candidate.track, index }))
                        .filter(({ candidate }) => {
                          const track = toTrack(candidate);
                          if (!track || track.download.status !== 'available') return false;
                          const key = trackKey(track);
                          const anySelected = Object.values(selectedTracks).some(Boolean);
                          return anySelected ? !!selectedTracks[key] : true;
                        });
                      void downloadAlbumTracks(toDownload);
                    }}
                    variant="primary"
                    loading={downloadingKey !== null}
                    disabled={downloadingKey !== null || !hasDownloadable(candidates)}
                    style={styles.albumActionButton}
                  />
                  <GlassButton
                    label="Download full album"
                    onPress={() => {
                      const toDownload = candidates.map((candidate, index) => ({ candidate: candidate.track, index }));
                      void downloadAlbumTracks(toDownload);
                    }}
                    variant="glass"
                    loading={downloadingKey !== null}
                    disabled={downloadingKey !== null || !allTracksAvailable(candidates)}
                    style={styles.albumActionButton}
                  />
                </View>
                   <GlassButton
                     label="Download album ZIP"
                     onPress={() => void downloadAlbumZip()}
                     variant="primary"
                     loading={zipping}
                     disabled={zipping || downloadingKey !== null || !hasDownloadable(candidates)}
                     style={styles.albumActionButton}
                   />

                {!allTracksAvailable(candidates) && candidates.length > 0 ? (
                  <Text style={styles.panelBody}>
                    Full album download is only offered when every track is authorised and available.
                  </Text>
                ) : null}
                <Text style={styles.panelBody}>
                  Tracks are saved as 01 - Track Title.mp3 inside Music/SoundCatch/{sanitizeFileName(result.artist)}/{sanitizeFileName(result.album || result.title)}.
                </Text>
              </View>
            ) : null}

            <GlassButton label="Listen again" onPress={reset} variant="glass" style={styles.cardAction} />
          </GlassCard>
        ) : null}

        <View style={styles.steps}>
          <Step index={1} title="Capture" body="A short clip is recorded locally with the microphone." />
          <Step index={2} title="Fingerprint" body="AudD matches the clip to a track." />
          <Step index={3} title="Collect" body="Save the match, then download it when the creator allows it." />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Step({ index, title, body }: { index: number; title: string; body: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepIndex}>
        <Text style={styles.stepIndexLabel}>{index}</Text>
      </View>
      <View style={styles.stepText}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepBody}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  stage: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  pulseRing: { position: 'absolute', top: spacing.xl, width: 148, height: 148, borderRadius: 74, backgroundColor: colors.highlight },
  micButton: { width: 148, height: 148, borderRadius: 74, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  micButtonActive: { backgroundColor: colors.highlight },
  micButtonPressed: { opacity: 0.85 },
  stageTitle: { ...typeTokens.heading, marginTop: spacing.xl, textAlign: 'center' },
  stageHint: { fontSize: 13, lineHeight: 19, color: colors.textMuted, textAlign: 'center', maxWidth: 320 },
  card: { marginTop: spacing.lg, gap: spacing.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  cardBody: { fontSize: 13, lineHeight: 19, color: colors.textMuted },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  cardAction: { marginTop: spacing.sm, minWidth: 150 },
  resultHeader: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  cover: { width: 112, height: 112, borderRadius: radius.lg, backgroundColor: colors.bgAlt },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  resultMeta: { flex: 1, gap: 4 },
  resultTitle: { ...typeTokens.title, fontSize: 20 },
  resultArtist: { fontSize: 15, color: 'rgba(248,250,252,0.8)' },
  resultAlbum: { fontSize: 13, color: colors.textMuted },
  resultYear: { fontSize: 13, color: colors.textMuted },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  action: { minWidth: 150 },
  steps: { marginTop: spacing.xl, gap: spacing.md },
  step: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  stepIndex: { width: 26, height: 26, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder },
  stepIndexLabel: { fontSize: 12, fontWeight: '700', color: colors.text },
  stepText: { flex: 1, gap: 2 },
  stepTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  stepBody: { fontSize: 12, lineHeight: 18, color: colors.textMuted },
  downloadButtons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  downloadButton: { flex: 1, borderRadius: radius.pill, overflow: 'hidden' },
  downloadButtonFill: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  downloadButtonLabel: { color: colors.text, fontSize: 15, fontWeight: '700' },
  panel: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder, gap: spacing.sm },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  panelTitle: { ...typeTokens.heading, fontSize: 16 },
  panelBody: { fontSize: 13, lineHeight: 19, color: colors.textMuted },
  panelLoading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  panelError: { fontSize: 12, lineHeight: 18, color: colors.danger },
  panelWarning: { fontSize: 12, lineHeight: 18, color: colors.warning },
  panelNote: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.sm },
  progressTrack: { height: 4, borderRadius: radius.pill, backgroundColor: colors.glass, overflow: 'hidden', marginTop: spacing.xs },
  progressFill: { height: 4, borderRadius: radius.pill, backgroundColor: colors.primary },
  candidateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.glassBorder },
  candidateCover: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.bgAlt },
  candidateMeta: { flex: 1, gap: 2 },
  candidateTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  candidateArtist: { fontSize: 12, color: colors.textMuted },
  candidateDetail: { fontSize: 11, color: colors.textMuted },
  candidateReasons: { fontSize: 10, color: colors.textMuted, fontStyle: 'italic' },
  candidateActions: { justifyContent: 'center' },
  candidateButton: { minWidth: 96 },
  albumHeader: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  albumCover: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.bgAlt },
  albumMeta: { flex: 1, gap: 2 },
  albumTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  albumArtist: { fontSize: 13, color: 'rgba(248,250,252,0.8)' },
  albumYear: { fontSize: 12, color: colors.textMuted },
  albumTracks: { fontSize: 12, color: colors.textMuted },
  albumTrackRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.glassBorder },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1, borderColor: colors.glassBorder, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  albumTrackMeta: { flex: 1, gap: 2 },
  albumTrackTitle: { fontSize: 13, fontWeight: '600', color: colors.text },
  albumTrackArtist: { fontSize: 11, color: colors.textMuted },
  availabilityBadge: { fontSize: 11, fontWeight: '700', paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1 },
  available: { color: colors.success, borderColor: 'rgba(52,211,153,0.4)' },
  unavailable: { color: colors.textMuted, borderColor: colors.glassBorder },
  albumActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  albumActionButton: { minWidth: 150 },
});
