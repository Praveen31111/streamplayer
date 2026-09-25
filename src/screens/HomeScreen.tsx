import React, { useEffect, useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { fetchTrendingFeed, searchYouTubeVideos, AppVideoItem } from '../api/youtubeClient';
import { prewarmVideoStream } from '../player/streamPrewarmer';
import { startGoogleSignIn, signOutGoogle, checkIsLoggedIn, AuthPromptData } from '../auth/authService';

export const HomeScreen = ({ navigation }: any) => {
  const [videos, setVideos] = useState<AppVideoItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Auth Dialog Modal
  const [authData, setAuthData] = useState<AuthPromptData | null>(null);
  const [isAuthModalVisible, setIsAuthModalVisible] = useState(false);

  const loadFeedData = async () => {
    setIsLoading(true);
    const loggedIn = await checkIsLoggedIn();
    setIsLoggedIn(loggedIn);

    const data = await fetchTrendingFeed();
    setVideos(data);
    setIsLoading(false);

    // SmartTube-style background pre-warming for zero-lag playback
    if (data && data.length > 0) {
      data.slice(0, 4).forEach(v => {
        if (v.id) prewarmVideoStream(v.id);
      });
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetching on mount is standard React pattern
    void loadFeedData();
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    if (searchQuery.trim()) {
      const results = await searchYouTubeVideos(searchQuery);
      setVideos(results);
    } else {
      await loadFeedData();
    }
    setIsRefreshing(false);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      loadFeedData();
      return;
    }
    setIsLoading(true);
    const results = await searchYouTubeVideos(searchQuery);
    setVideos(results);
    setIsLoading(false);
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
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => { setSearchQuery(''); loadFeedData(); }}>
              <Ionicons name="close-circle" size={18} color="#888" />
            </TouchableOpacity>
          )}
        </View>
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
          keyExtractor={(item, index) => item.id || index.toString()}
          renderItem={renderVideoCard}
          contentContainerStyle={styles.listContent}
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
});
