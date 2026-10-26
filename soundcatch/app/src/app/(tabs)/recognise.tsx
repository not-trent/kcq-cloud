import { Ionicons } from '@expo/vector-icons';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GlassCard } from '@/components/glass/GlassCard';
import { GlassButton } from '@/components/glass/GlassButton';
import { useDockSpace } from '@/components/GlassDock';
import { ScreenHeader } from '@/components/ScreenHeader';
import { colors, radius, spacing, type } from '@/theme/tokens';

const LISTEN_SECONDS = 10;

type Phase = 'idle' | 'requesting' | 'recording' | 'captured' | 'denied' | 'error';

export default function RecogniseScreen() {
  const dockSpace = useDockSpace();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);

  const [phase, setPhase] = useState<Phase>('idle');
  const [capturedSeconds, setCapturedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (phase !== 'recording') {
      pulse.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [phase, pulse]);

  // Recording stops itself after LISTEN_SECONDS, so watch for that transition.
  useEffect(() => {
    if (phase !== 'recording') return;
    if (recorderState.isRecording || !recorderState.url) return;
    setCapturedSeconds(Math.max(1, Math.round(recorderState.durationMillis / 1000)));
    setPhase('captured');
    void setAudioModeAsync({ allowsRecording: false });
  }, [phase, recorderState.isRecording, recorderState.url, recorderState.durationMillis]);

  const start = async () => {
    setError(null);
    setPhase('requesting');
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setPhase('denied');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record({ forDuration: LISTEN_SECONDS });
      setPhase('recording');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The microphone could not be started.');
      setPhase('error');
      void setAudioModeAsync({ allowsRecording: false });
    }
  };

  const stop = async () => {
    try {
      await recorder.stop();
    } catch {
      // A recorder that already stopped itself is not an error worth surfacing.
    }
  };

  const reset = () => {
    setCapturedSeconds(0);
    setError(null);
    setPhase('idle');
  };

  const elapsed = Math.min(LISTEN_SECONDS, Math.floor(recorderState.durationMillis / 1000));
  const recording = phase === 'recording';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: dockSpace }}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader title="Recognise" subtitle="Listen for a moment, then match it to a track." />

        <View style={styles.stage}>
          <Animated.View
            style={[
              styles.pulseRing,
              {
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
                transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] }) }],
              },
            ]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={recording ? 'Stop listening' : 'Start listening'}
            accessibilityState={{ busy: recording, disabled: phase === 'requesting' }}
            disabled={phase === 'requesting'}
            onPress={recording ? () => void stop() : () => void start()}
            style={({ pressed }) => [
              styles.micButton,
              recording && styles.micButtonActive,
              pressed && styles.micButtonPressed,
            ]}
          >
            <Ionicons name={recording ? 'stop' : 'mic'} size={44} color={colors.text} />
          </Pressable>

          <Text style={styles.stageTitle}>
            {phase === 'idle'
              ? 'Tap to listen'
              : phase === 'requesting'
                ? 'Starting the microphone…'
                : recording
                  ? `Listening… ${elapsed}s of ${LISTEN_SECONDS}s`
                  : phase === 'captured'
                    ? `Captured ${capturedSeconds}s of audio`
                    : phase === 'denied'
                      ? 'Microphone access is off'
                      : 'Something went wrong'}
          </Text>
          <Text style={styles.stageHint}>
            {phase === 'captured'
              ? 'The audio is ready, but matching is not connected yet.'
              : 'SoundCatch records a short clip on this device. Nothing is uploaded while matching is unavailable.'}
          </Text>
        </View>

        {phase === 'denied' ? (
          <GlassCard padding={spacing.lg} style={styles.card}>
            <Text style={styles.cardTitle}>Allow the microphone</Text>
            <Text style={styles.cardBody}>
              Recognition needs microphone access. You can enable it in the system settings, then come back and try again.
            </Text>
            <GlassButton label="Open settings" onPress={() => void Linking.openSettings()} variant="glass" style={styles.cardAction} />
          </GlassCard>
        ) : null}

        {phase === 'error' && error ? (
          <GlassCard padding={spacing.lg} style={styles.card}>
            <Text style={styles.cardTitle}>Microphone unavailable</Text>
            <Text style={styles.cardBody}>{error}</Text>
            <GlassButton label="Try again" onPress={reset} variant="glass" style={styles.cardAction} />
          </GlassCard>
        ) : null}

        {phase === 'captured' ? (
          <GlassCard padding={spacing.lg} style={styles.card}>
            <View style={styles.cardHead}>
              <Ionicons name="information-circle" size={18} color={colors.warning} />
              <Text style={styles.cardTitle}>Matching is not connected</Text>
            </View>
            <Text style={styles.cardBody}>
              Capture works end to end on the device. Turning a clip into a track needs a fingerprint provider such as
              ACRCloud or AudD configured on the SoundCatch server, and the server does not have one yet.
            </Text>
            <Text style={styles.cardBody}>
              Until then, search by name or paste a SoundCloud link — both use the live catalogue.
            </Text>
            <View style={styles.cardActions}>
              <GlassButton label="Search by name" onPress={() => router.push('/search')} variant="primary" style={styles.cardAction} />
              <GlassButton label="Listen again" onPress={reset} variant="glass" style={styles.cardAction} />
            </View>
          </GlassCard>
        ) : null}

        <View style={styles.steps}>
          <Step index={1} title="Capture" body="A short clip is recorded locally with the microphone." />
          <Step index={2} title="Fingerprint" body="A provider turns the clip into a track match. Not connected yet." />
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
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  stage: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  pulseRing: {
    position: 'absolute',
    top: spacing.xl,
    width: 148,
    height: 148,
    borderRadius: 74,
    backgroundColor: colors.highlight,
  },
  micButton: {
    width: 148,
    height: 148,
    borderRadius: 74,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  micButtonActive: {
    backgroundColor: colors.highlight,
  },
  micButtonPressed: {
    opacity: 0.85,
  },
  stageTitle: {
    ...type.heading,
    marginTop: spacing.xl,
    textAlign: 'center',
  },
  stageHint: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
    textAlign: 'center',
    maxWidth: 320,
  },
  card: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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
  cardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  cardAction: {
    marginTop: spacing.sm,
    minWidth: 150,
  },
  steps: {
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  step: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  stepIndex: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  stepIndexLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  stepText: {
    flex: 1,
    gap: 2,
  },
  stepTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  stepBody: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
});
