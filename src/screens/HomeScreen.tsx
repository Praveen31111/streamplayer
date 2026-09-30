import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Linking,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import {
  fetchTrendingFeedWithContinuation,
  searchYouTubeVideosWithContinuation,
  fetchSearchSuggestions,
  AppVideoItem,
} from '../api';
import { prewarmVideoStream } from '../player/streamPrewarmer';
import { startGoogleSignIn, signOutGoogle, checkIsLoggedIn, AuthPromptData } from '../auth/authService';

export const HomeScreen = ({ navigation }: any) => {
  const [videos, setVideos] = useState<AppVideoItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Pagination & Continuation Refs for infinite scroll
  const isFetchingMoreRef = useRef(false);
  const homeContinuationTokenRef = useRef<string | undefined>(undefined);
  const searchContinuationTokenRef = useRef<string | undefined>(undefined);
  const homePageIndexRef = useRef(0);

  // Auth Dialog Modal
  const [authData, setAuthData] = useState<AuthPromptData | null>(null);
  const [isAuthModalVisible, setIsAuthModalVisible] = useState(false);

  const loadFeedData = async () => {
    setIsLoading(true);
    homeContinuationTokenRef.current = undefined;
    searchContinuationTokenRef.current = undefined;
    homePageIndexRef.current = 0;

    try {
      const loggedIn = await checkIsLoggedIn();
      setIsLoggedIn(loggedIn);

      const data = await fetchTrendingFeedWithContinuation(undefined, 0);
      setVideos(data.videos || []);
      homeContinuationTokenRef.current = data.continuationToken;

      // SmartTube-style background pre-warming for zero-lag playback
      if (data.videos && data.videos.length > 0) {
        data.videos.slice(0, 4).forEach(v => {
          if (v.id) prewarmVideoStream(v.id);
        });
      }
    } catch (err) {
      console.warn('[HomeScreen] loadFeedData error caught:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetching on mount is standard React pattern
    void loadFeedData();
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (searchQuery.trim()) {
        searchContinuationTokenRef.current = undefined;
        const results = await searchYouTubeVideosWithContinuation(searchQuery.trim());
        setVideos(results.videos || []);
        searchContinuationTokenRef.current = results.continuationToken;
      } else {
        await loadFeedData();
      }
    } catch (err) {
      console.warn('[HomeScreen] handleRefresh error caught:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleLoadMore = async () => {
    if (isLoading || isRefreshing || isFetchingMoreRef.current) return;
    if (videos.length === 0) return;

    isFetchingMoreRef.current = true;
    setIsFetchingMore(true);

    try {
      const isSearching = searchQuery.trim().length > 0;

      if (isSearching) {
        const token = searchContinuationTokenRef.current;
        if (!token) {
          return;
        }

        const result = await searchYouTubeVideosWithContinuation('', token);
        searchContinuationTokenRef.current = result.continuationToken;

        if (result.videos.length > 0) {
          setVideos(prev => {
            const existingIds = new Set(prev.map(v => v.id));
            const newVideos = result.videos.filter(v => !existingIds.has(v.id));
            return [...prev, ...newVideos];
          });

          if (result.videos[0]?.id) {
            prewarmVideoStream(result.videos[0].id);
          }
        }
      } else {
        // Endless Home feed pagination
        homePageIndexRef.current += 1;
        const token = homeContinuationTokenRef.current;

        const result = await fetchTrendingFeedWithContinuation(token, homePageIndexRef.current);
        homeContinuationTokenRef.current = result.continuationToken;

        if (result.videos.length > 0) {
          setVideos(prev => {
            const existingIds = new Set(prev.map(v => v.id));
            const newVideos = result.videos.filter(v => !existingIds.has(v.id));
            return [...prev, ...newVideos];
          });

          if (result.videos[0]?.id) {
            prewarmVideoStream(result.videos[0].id);
          }
        }
      }
    } catch (err) {
      console.warn('[HomeScreen] handleLoadMore error:', err);
    } finally {
      isFetchingMoreRef.current = false;
      setIsFetchingMore(false);
    }
  };

  const handleQueryChange = (text: string) => {
    setSearchQuery(text);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!text.trim()) {
      setSuggestions([]);
      return;
    }

    // Fast 150ms debounce for smooth typing
    searchTimeoutRef.current = setTimeout(async () => {
      const list = await fetchSearchSuggestions(text);
      setSuggestions(list);
    }, 150);
  };

  const handleSelectSuggestion = (suggestion: string) => {
    setSearchQuery(suggestion);
    setSuggestions([]);
    setIsSearchFocused(false);
    Keyboard.dismiss();
    executeSearch(suggestion);
  };

  const handleAppendSuggestion = (suggestion: string) => {
    setSearchQuery(suggestion);
    handleQueryChange(suggestion);
  };

  const executeSearch = async (queryText?: string) => {
    const q = (queryText !== undefined ? queryText : searchQuery).trim();
    setSuggestions([]);
    setIsSearchFocused(false);
    Keyboard.dismiss();

    if (!q) {
      loadFeedData();
      return;
    }

    setIsLoading(true);
    searchContinuationTokenRef.current = undefined;

    try {
      const results = await searchYouTubeVideosWithContinuation(q);
      setVideos(results.videos || []);
      searchContinuationTokenRef.current = results.continuationToken;

      // Prewarm top 3 results
      if (results.videos && results.videos.length > 0) {
        results.videos.slice(0, 3).forEach(v => {
          if (v.id) prewarmVideoStream(v.id);
        });
      }
    } catch (err) {
      console.warn('[HomeScreen] executeSearch error caught:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoginPress = () => {
    setIsAuthModalVisible(true);
    startGoogleSignIn(
      data => {
        setAuthData(data);
      },
      () => {
        setIsAuthModalVisible(false);
        setAuthData(null);
        loadFeedData();
      },
      err => {
        console.error('Login error:', err);
        setIsAuthModalVisible(false);
      }
    );
  };

  const handleSignOut = async () => {
    await signOutGoogle();
    setIsLoggedIn(false);
    loadFeedData();
  };

  const renderVideoCard = ({ item }: { item: AppVideoItem }) => (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={() =>
        navigation.navigate('PlayerDetail', {
          videoId: item.id,
          title: item.title,
          author: item.author,
          thumbnailUrl: item.thumbnail,
        })
      }
    >
      <View style={styles.thumbnailWrapper}>
        <Image source={{ uri: item.thumbnail }} style={styles.thumbnail} contentFit="cover" />
        {item.duration && (
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>{item.duration}</Text>
          </View>
        )}
      </View>

      <View style={styles.detailsRow}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => {
            if (item.channelId) {
              navigation.navigate('Channel', {
                channelId: item.channelId,
                channelTitle: item.author,
                channelAvatar: item.authorAvatar,
              });
            }
          }}
          style={styles.avatarPlaceholder}
        >
          {item.authorAvatar ? (
            <Image source={{ uri: item.authorAvatar }} style={styles.avatarImg} />
          ) : (
            <Ionicons name="person-circle" size={38} color="#555" />
          )}
        </TouchableOpacity>

        <View style={styles.metaContainer}>
          <Text style={styles.title} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={styles.channelText} numberOfLines={1}>
            {item.author} {item.viewCount ? `• ${item.viewCount}` : ''} {item.published ? `• ${item.published}` : ''}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Top Bar with Logo, Account Avatar & Search */}
      <View style={styles.header}>
        <View style={styles.topRow}>
          <View style={styles.logoRow}>
            <Ionicons name="play-circle" size={28} color="#FF0000" />
            <Text style={styles.logoText}>
              Stream<Text style={{ color: '#FF0000' }}>Player</Text>
            </Text>
            {isLoggedIn && (
              <View style={styles.premiumTag}>
                <Text style={styles.premiumTagText}>PREMIUM</Text>
              </View>
            )}
          </View>

          {/* User Account / Sign In Action */}
          {isLoggedIn ? (
            <TouchableOpacity onPress={handleSignOut} style={styles.accountBtnActive}>
              <Ionicons name="person-circle" size={24} color="#00E676" />
              <Text style={styles.accountTextActive}>Signed In</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handleLoginPress} style={styles.signInBtn}>
              <Ionicons name="logo-google" size={14} color="#000" />
              <Text style={styles.signInBtnText}>Sign In</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Search Bar */}
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color="#888" style={{ marginRight: 8 }} />
          <TextInput
            placeholder="Search videos, music, channels..."
            placeholderTextColor="#777"
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={handleQueryChange}
            onFocus={() => {
              setIsSearchFocused(true);
              if (searchQuery.trim()) {
                fetchSearchSuggestions(searchQuery).then(setSuggestions);
              }
            }}
            onSubmitEditing={() => executeSearch()}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                setSearchQuery('');
                setSuggestions([]);
                searchContinuationTokenRef.current = undefined;
                loadFeedData();
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={18} color="#888" />
            </TouchableOpacity>
          )}
        </View>

        {/* Real-time Search Autocomplete Suggestions Dropdown */}
        {isSearchFocused && suggestions.length > 0 && (
          <View style={styles.suggestionsContainer}>
            <FlatList
              data={suggestions}
              keyExtractor={(item, index) => `${item}-${index}`}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.suggestionItem}
                  onPress={() => handleSelectSuggestion(item)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="search-outline" size={18} color="#888888" style={{ marginRight: 12 }} />
                  <Text style={styles.suggestionText} numberOfLines={1}>
                    {item}
                  </Text>
                  <TouchableOpacity
                    style={styles.suggestionArrowBtn}
                    onPress={() => handleAppendSuggestion(item)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons
                      name="arrow-back-outline"
                      size={16}
                      color="#777777"
                      style={{ transform: [{ rotate: '45deg' }] }}
                    />
                  </TouchableOpacity>
                </TouchableOpacity>
              )}
            />
          </View>
        )}
      </View>

      {/* Videos List */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#FF0000" />
          <Text style={styles.loadingText}>Fetching YouTube Feeds...</Text>
        </View>
      ) : (
        <FlatList
          data={videos}
          keyExtractor={(item, index) => `${item.id || 'vid'}-${index}`}
          renderItem={renderVideoCard}
          contentContainerStyle={styles.listContent}
          onScrollBeginDrag={() => {
            setIsSearchFocused(false);
            Keyboard.dismiss();
          }}
          onTouchStart={() => {
            if (isSearchFocused) {
              setIsSearchFocused(false);
              Keyboard.dismiss();
            }
          }}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isFetchingMore ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator size="small" color="#FF0000" />
                <Text style={styles.footerLoaderText}>Loading more content...</Text>
              </View>
            ) : (
              <View style={{ height: 28 }} />
            )
          }
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor="#FF0000"
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="videocam-off-outline" size={48} color="#555" />
              <Text style={styles.emptyText}>No videos found</Text>
            </View>
          }
        />
      )}

      {/* Auth Verification Modal */}
      <Modal visible={isAuthModalVisible} transparent={true} animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Ionicons name="key-outline" size={40} color="#FF0000" />
            <Text style={styles.modalTitle}>Device Authorization</Text>

            {authData ? (
              <>
                <Text style={styles.modalSub}>
                  Enter this code on Google verification page to sync your real YouTube account:
                </Text>
                <View style={styles.codeBox}>
                  <Text style={styles.codeText}>{authData.userCode}</Text>
                </View>
                <TouchableOpacity
                  style={styles.openUrlBtn}
                  onPress={() => Linking.openURL(authData.verificationUrl)}
                >
                  <Text style={styles.openUrlBtnText}>Open Google Login Page</Text>
                </TouchableOpacity>
                <Text style={styles.waitingText}>Waiting for approval...</Text>
              </>
            ) : (
              <ActivityIndicator size="small" color="#FF0000" style={{ marginVertical: 20 }} />
            )}

            <TouchableOpacity
              onPress={() => setIsAuthModalVisible(false)}
              style={styles.cancelBtn}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F0F',
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    backgroundColor: '#161616',
    borderBottomWidth: 1,
    borderBottomColor: '#252525',
    gap: 10,
    zIndex: 100,
    position: 'relative',
  },
  suggestionsContainer: {
    position: 'absolute',
    top: 98,
    left: 16,
    right: 16,
    backgroundColor: '#1C1C24',
    borderRadius: 14,
    zIndex: 999,
    maxHeight: 280,
    elevation: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden',
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  suggestionText: {
    flex: 1,
    color: '#F0F0F0',
    fontSize: 14,
    fontWeight: '500',
  },
  suggestionArrowBtn: {
    padding: 6,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  logoText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  premiumTag: {
    backgroundColor: '#FF0000',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 4,
  },
  premiumTagText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  signInBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
  },
  signInBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '700',
  },
  accountBtnActive: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#222',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    gap: 4,
  },
  accountTextActive: {
    color: '#00E676',
    fontSize: 11,
    fontWeight: '700',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#222222',
    borderRadius: 20,
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
  },
  listContent: {
    paddingBottom: 24,
  },
  card: {
    marginBottom: 16,
  },
  thumbnailWrapper: {
    width: '100%',
    height: 215,
    backgroundColor: '#202020',
    position: 'relative',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  durationBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  durationText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  detailsRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 10,
  },
  avatarPlaceholder: {
    width: 38,
    height: 38,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImg: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  metaContainer: {
    flex: 1,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 19,
  },
  channelText: {
    color: '#AAAAAA',
    fontSize: 12,
    marginTop: 3,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    color: '#888',
    fontSize: 13,
    marginTop: 10,
  },
  emptyText: {
    color: '#888',
    fontSize: 14,
    marginTop: 10,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#1E1E1E',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
  modalTitle: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  modalSub: { color: '#AAA', fontSize: 13, textAlign: 'center' },
  codeBox: {
    backgroundColor: '#2A2A2A',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#444',
  },
  codeText: { color: '#00E676', fontSize: 24, fontWeight: 'bold', letterSpacing: 2 },
  openUrlBtn: {
    backgroundColor: '#FF0000',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
  },
  openUrlBtnText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  waitingText: { color: '#777', fontSize: 12, fontStyle: 'italic' },
  cancelBtn: { marginTop: 8 },
  cancelText: { color: '#AAA', fontSize: 14 },
  footerLoader: {
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  footerLoaderText: {
    color: '#AAAAAA',
    fontSize: 13,
    fontWeight: '500',
  },
});
