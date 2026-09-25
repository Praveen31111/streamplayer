import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { getWatchHistory, clearWatchHistory, HistoryItem } from '../database/repositories/historyRepo';
import { getBookmarks, BookmarkItem } from '../database/repositories/bookmarkRepo';
import { fetchUserLibrary, UserLibraryData } from '../api/userService';
import { checkIsLoggedIn } from '../auth/authService';

type TabType = 'history' | 'bookmarks' | 'liked' | 'playlists';

export const LibraryScreen = ({ navigation }: any) => {
  const [activeTab, setActiveTab] = useState<TabType>('history');
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [userLibrary, setUserLibrary] = useState<UserLibraryData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const loadData = async () => {
    setIsLoading(true);
    const loggedIn = await checkIsLoggedIn();
    setIsLoggedIn(loggedIn);

    const historyData = await getWatchHistory();
    setHistory(historyData);

    const bookmarksData = await getBookmarks();
    setBookmarks(bookmarksData);

    if (loggedIn) {
      const lib = await fetchUserLibrary();
      setUserLibrary(lib);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadData();
    });
    return unsubscribe;
  }, [navigation]);

  const handleClearHistory = async () => {
    await clearWatchHistory();
    setHistory([]);
  };

  const renderHistoryCard = ({ item }: { item: HistoryItem }) => {
    const progressPercent = item.totalDurationMillis
      ? (item.lastPositionMillis / item.totalDurationMillis) * 100
      : 0;

    return (
      <TouchableOpacity
        style={styles.historyCard}
        activeOpacity={0.8}
        onPress={() =>
          navigation.navigate('PlayerDetail', {
            videoId: item.videoId,
            title: item.title,
            author: item.author,
            thumbnailUrl: item.thumbnailUrl,
          })
        }
      >
        <View style={styles.thumbnailBox}>
          <Image source={{ uri: item.thumbnailUrl }} style={styles.thumb} contentFit="cover" />
          <View style={styles.progressBack}>
            <View style={[styles.progressFront, { width: `${progressPercent}%` }]} />
          </View>
        </View>

        <View style={styles.meta}>
          <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
          <Text style={styles.author}>{item.author}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderBookmarkCard = ({ item }: { item: BookmarkItem }) => (
    <TouchableOpacity
      style={styles.historyCard}
      activeOpacity={0.8}
      onPress={() =>
        navigation.navigate('PlayerDetail', {
          videoId: item.videoId,
          title: item.title,
          author: item.author,
          thumbnailUrl: item.thumbnailUrl,
        })
      }
    >
      <View style={styles.thumbnailBox}>
        <Image source={{ uri: item.thumbnailUrl }} style={styles.thumb} contentFit="cover" />
      </View>

      <View style={styles.meta}>
        <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
        <Text style={styles.author}>{item.author}</Text>
      </View>
    </TouchableOpacity>
  );

  const renderFeedCard = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={styles.historyCard}
      activeOpacity={0.8}
      onPress={() =>
        navigation.navigate('PlayerDetail', {
          videoId: item.id,
          title: item.title,
          author: item.author,
          thumbnailUrl: item.thumbnail,
        })
      }
    >
      <View style={styles.thumbnailBox}>
        <Image source={{ uri: item.thumbnail }} style={styles.thumb} contentFit="cover" />
      </View>

      <View style={styles.meta}>
        <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
        <Text style={styles.author}>{item.author}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Library</Text>
        {activeTab === 'history' && history.length > 0 && (
          <TouchableOpacity onPress={handleClearHistory}>
            <Text style={styles.clearBtnText}>Clear History</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Filter Tabs */}
      <View style={styles.tabBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabScroll}>
          <TouchableOpacity
            style={[styles.tabItem, activeTab === 'history' && styles.tabItemActive]}
            onPress={() => setActiveTab('history')}
          >
            <Ionicons name="time-outline" size={16} color={activeTab === 'history' ? '#FFF' : '#888'} />
            <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>History</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabItem, activeTab === 'bookmarks' && styles.tabItemActive]}
            onPress={() => setActiveTab('bookmarks')}
          >
            <Ionicons name="bookmark-outline" size={16} color={activeTab === 'bookmarks' ? '#FFF' : '#888'} />
            <Text style={[styles.tabText, activeTab === 'bookmarks' && styles.tabTextActive]}>Saved</Text>
          </TouchableOpacity>

          {isLoggedIn && (
            <>
              <TouchableOpacity
                style={[styles.tabItem, activeTab === 'liked' && styles.tabItemActive]}
                onPress={() => setActiveTab('liked')}
              >
                <Ionicons name="thumbs-up-outline" size={16} color={activeTab === 'liked' ? '#FFF' : '#888'} />
                <Text style={[styles.tabText, activeTab === 'liked' && styles.tabTextActive]}>Liked</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.tabItem, activeTab === 'playlists' && styles.tabItemActive]}
                onPress={() => setActiveTab('playlists')}
              >
                <Ionicons name="list-outline" size={16} color={activeTab === 'playlists' ? '#FFF' : '#888'} />
                <Text style={[styles.tabText, activeTab === 'playlists' && styles.tabTextActive]}>Playlists</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </View>

      {/* Tab Content */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#FF0000" />
        </View>
      ) : activeTab === 'history' ? (
        <FlatList
          data={history}
          keyExtractor={item => item.videoId}
          renderItem={renderHistoryCard}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="film-outline" size={44} color="#555" />
              <Text style={styles.emptyText}>No watch history yet</Text>
            </View>
          }
        />
      ) : activeTab === 'bookmarks' ? (
        <FlatList
          data={bookmarks}
          keyExtractor={item => item.videoId}
          renderItem={renderBookmarkCard}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="bookmark-outline" size={44} color="#555" />
              <Text style={styles.emptyText}>No saved bookmarks</Text>
            </View>
          }
        />
      ) : activeTab === 'liked' ? (
        <FlatList
          data={userLibrary?.likedVideos || []}
          keyExtractor={(item, index) => item.id || index.toString()}
          renderItem={renderFeedCard}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="thumbs-up-outline" size={44} color="#555" />
              <Text style={styles.emptyText}>No liked videos found</Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={userLibrary?.playlists || []}
          keyExtractor={(item, index) => item.id || index.toString()}
          renderItem={({ item }) => (
            <View style={styles.historyCard}>
              <View style={styles.thumbnailBox}>
                <Image source={{ uri: item.thumbnail }} style={styles.thumb} contentFit="cover" />
              </View>
              <View style={styles.meta}>
                <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
                <Text style={styles.author}>{item.videoCount || 'Playlist'}</Text>
              </View>
            </View>
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="list-outline" size={44} color="#555" />
              <Text style={styles.emptyText}>No playlists found</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F0F' },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#161616',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#252525',
  },
  headerTitle: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  clearBtnText: { color: '#FF5252', fontSize: 13, fontWeight: '600' },
  tabBar: {
    backgroundColor: '#161616',
    borderBottomWidth: 1,
    borderBottomColor: '#252525',
  },
  tabScroll: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    flexDirection: 'row',
  },
  tabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#222',
  },
  tabItemActive: {
    backgroundColor: '#FF0000',
  },
  tabText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#FFF',
    fontWeight: '700',
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  list: { paddingHorizontal: 12, paddingVertical: 14, paddingBottom: 30 },
  historyCard: {
    flexDirection: 'row',
    marginBottom: 12,
    gap: 12,
    backgroundColor: '#161616',
    borderRadius: 8,
    overflow: 'hidden',
  },
  thumbnailBox: { width: 120, height: 70, backgroundColor: '#222', position: 'relative' },
  thumb: { width: '100%', height: '100%' },
  progressBack: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, backgroundColor: '#444' },
  progressFront: { height: '100%', backgroundColor: '#FF0000' },
  meta: { flex: 1, justifyContent: 'center', paddingRight: 8 },
  title: { color: '#FFF', fontSize: 13, fontWeight: '600' },
  author: { color: '#888', fontSize: 11, marginTop: 4 },
  emptyText: { color: '#666', fontSize: 13, marginTop: 8 },
});
