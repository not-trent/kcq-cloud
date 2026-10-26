import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useAudioPlayer } from 'expo-audio';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GlassButton } from '@/components/glass/GlassButton';
import { GlassCard } from '@/components/glass/GlassCard';
import { useDockSpace } from '@/components/GlassDock';
import { ScreenHeader } from '@/components/ScreenHeader';
import { api, type RecogniseResult, type Track, type UnifiedTrack } from '@/lib/api';
import { downloadTrack } from '@/lib/downloads';
import { library } from '@/store/library';
import { colors, radius, spacing, type as typeTokens } from '@/theme/tokens';

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
              {result.soundcloud?.downloadable ? (
                <GlassButton
                  label="Download"
                  onPress={() => void downloadResult()}
                  variant="primary"
                  loading={downloading}
                  disabled={downloading}
                  style={styles.action}
                />
              ) : null}
            </View>

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
});
