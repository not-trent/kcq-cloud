import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState } from '@/components/EmptyState';
import { useDockSpace } from '@/components/GlassDock';
import { ScreenHeader } from '@/components/ScreenHeader';
import { api, looksLikeUrl, type UnifiedTrack } from '@/lib/api';
import { library, useLibrary } from '@/store/library';
import { colors, radius, spacing } from '@/theme/tokens';

type Phase = 'idle' | 'loading' | 'done' | 'error';

const DEBOUNCE_MS = 450;

export default function SearchScreen() {
  const params = useLocalSearchParams<{ q?: string }>();
  const { recentSearches } = useLibrary();
  const dockSpace = useDockSpace();

  const [text, setText] = useState(typeof params.q === 'string' ? params.q : '');
  const [phase, setPhase] = useState<Phase>('idle');
  const [items, setItems] = useState<UnifiedTrack[]>([]);
  const [nextOffset, setNextOffset] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const requestId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const lastQuery = useRef('');

  const run = useCallback(async (raw: string) => {
    const query = raw.trim();
    if (!query) return;
    lastQuery.current = query;
    const id = ++requestId.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase('loading');
    setError(null);
    setItems([]);
    setNextOffset(undefined);

    try {
      if (looksLikeUrl(query)) {
        const track = await api.resolve(query, controller.signal);
        if (id !== requestId.current) return;
        library.addRecentSearch(query);
        setItems([track]);
        setPhase('done');
        if (track.provider && track.id) {
          router.push({
            pathname: '/track/[provider]/[id]',
            params: { provider: track.provider, id: track.id },
          });
        } else if (track.sourceUrl) {
          void Linking.openURL(track.sourceUrl);
        }
        return;
      }

      const page = await api.search(query, { signal: controller.signal });
      if (id !== requestId.current) return;
      setItems(page.items);
      setNextOffset(page.nextOffset);
      setPhase('done');
      if (page.items.length > 0) library.addRecentSearch(query);
    } catch (cause) {
      if (id !== requestId.current) return;
      setPhase('error');
      setError(cause instanceof Error ? cause.message : 'Something went wrong.');
    }
  }, []);

  // A short pause after typing keeps a search from firing on every keystroke.
  useEffect(() => {
    const query = text.trim();
    if (!query) {
      setPhase('idle');
      setItems([]);
      setNextOffset(undefined);
      setError(null);
      return;
    }
    if (!looksLikeUrl(query) && query.length < 2) return;
    if (query === lastQuery.current) return;

    const timer = setTimeout(() => {
      void run(query);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, run]);

  const loadMore = useCallback(async () => {
    const query = lastQuery.current;
    if (!query || nextOffset === undefined || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.search(query, { offset: nextOffset });
      setItems((previous) => [...previous, ...page.items]);
      setNextOffset(page.nextOffset);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load more results.');
    } finally {
      setLoadingMore(false);
    }
  }, [nextOffset, loadingMore]);

  const clear = () => {
    abortRef.current?.abort();
    requestId.current += 1;
    lastQuery.current = '';
    setText('');
    setItems([]);
    setNextOffset(undefined);
    setError(null);
    setPhase('idle');
  };

  const idle = phase === 'idle' && !text.trim();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        data={items}
        keyExtractor={(item, index) => `${item.source}-${item.provider ?? ''}-${item.id ?? item.sourceUrl ?? item.title}-${index}`}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: dockSpace }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        onEndReachedThreshold={0.4}
        onEndReached={() => void loadMore()}
        ListHeaderComponent={
          <View>
            <ScreenHeader title="Search" subtitle="SoundCloud tracks by name, or paste a link." />

            <View style={styles.searchBar}>
              <Ionicons name="search" size={18} color={colors.textMuted} />
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Track, artist or soundcloud.com link"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                onSubmitEditing={() => void run(text)}
                style={styles.input}
                accessibilityLabel="Search query"
              />
              {text ? (
                <Pressable onPress={clear} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color={colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
                <Pressable onPress={() => void run(text)} accessibilityRole="button" hitSlop={8}>
                  <Text style={styles.retry}>Retry</Text>
                </Pressable>
              </View>
            ) : null}

            {idle ? (
              <View style={styles.idleBlock}>
                {recentSearches.length > 0 ? (
                  <>
                    <Text style={styles.sectionTitle}>Recent searches</Text>
                    <View style={styles.chips}>
                      {recentSearches.map((query) => (
                        <Pressable
                          key={query}
                          onPress={() => setText(query)}
                          accessibilityRole="button"
                          style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
                        >
                          <Text style={styles.chipLabel} numberOfLines={1}>
                            {query}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </>
                ) : null}
                <EmptyState
                  icon="musical-notes-outline"
                  title="Find something to catch"
                  message="Search the SoundCloud catalogue by track or artist, or paste a track link to resolve it directly."
                />
              </View>
            ) : null}

            {phase === 'done' && items.length > 0 ? (
              <Text style={styles.resultCount}>
                {items.length}
                {nextOffset === undefined ? '' : '+'} result{items.length === 1 ? '' : 's'} for “{lastQuery.current}”
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item }) => {
          const badgeLabel =
            item.source === 'deezer' ? 'Deezer' : item.source === 'itunes' ? 'iTunes' : 'SoundCloud';
          const badgeColor =
            item.source === 'deezer' ? colors.secondary : item.source === 'itunes' ? colors.highlight : colors.success;
          const open = () => {
            if (item.source === 'soundcloud' && item.provider && item.id) {
              router.push({ pathname: '/track/[provider]/[id]', params: { provider: item.provider, id: item.id } });
            } else if (item.sourceUrl) {
              void Linking.openURL(item.sourceUrl);
            }
          };
          return (
            <Pressable onPress={open} style={({ pressed }) => [styles.resultRow, pressed && styles.pressed]}>
              {item.coverUrl ? (
                <Image source={{ uri: item.coverUrl }} style={styles.cover} contentFit="cover" transition={150} />
              ) : (
                <View style={[styles.cover, styles.coverFallback]}>
                  <Ionicons name="musical-notes" size={20} color={colors.textMuted} />
                </View>
              )}
              <View style={styles.resultBody}>
                <Text style={styles.resultTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.resultArtist} numberOfLines={1}>
                  {item.artist}
                </Text>
              </View>
              <View style={[styles.badge, { borderColor: badgeColor }]}>
                <Text style={[styles.badgeText, { color: badgeColor }]}>{badgeLabel}</Text>
              </View>
            </Pressable>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          phase === 'loading' ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.loadingText}>{looksLikeUrl(text) ? 'Resolving link…' : 'Searching…'}</Text>
            </View>
          ) : phase === 'done' ? (
            <EmptyState
              icon="search-outline"
              title="No matches"
              message={`Nothing on SoundCloud matched “${lastQuery.current}”. Try a different spelling or artist name.`}
            />
          ) : undefined
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footerLoading}>
              <ActivityIndicator color={colors.secondary} size="small" />
            </View>
          ) : nextOffset !== undefined ? (
            <Pressable onPress={() => void loadMore()} accessibilityRole="button" style={styles.loadMore}>
              <Text style={styles.loadMoreLabel}>Load more</Text>
            </Pressable>
          ) : undefined
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 50,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    paddingVertical: 0,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(248,113,113,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.35)',
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: colors.text,
  },
  retry: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.secondary,
  },
  idleBlock: {
    marginTop: spacing.lg,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
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
  chipPressed: {
    opacity: 0.7,
  },
  chipLabel: {
    fontSize: 13,
    color: colors.text,
  },
  resultCount: {
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
    fontSize: 12,
    color: colors.textMuted,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.glassBorder,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
  cover: {
    width: 52,
    height: 52,
    borderRadius: radius.sm,
    backgroundColor: colors.bgAlt,
  },
  coverFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultBody: {
    flex: 1,
    gap: 2,
  },
  resultTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  resultArtist: {
    fontSize: 13,
    color: colors.textMuted,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  loading: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  loadingText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  footerLoading: {
    paddingVertical: spacing.lg,
  },
  loadMore: {
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  loadMoreLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
});
