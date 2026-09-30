import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { fetchChannelDetailsDirect, fetchChannelMoreVideosDirect } from '../api/mediaServiceCore';
import { ChannelDetails, AppVideoItem, ChannelPlaylistItem } from '../api/types';
import { stopGlobalAudio } from '../player';
import {
  toggleChannelSubscription,
  checkChannelSubscriptionStatus,
} from '../api/userService';

export const ChannelScreen = ({ route, navigation }: any) => {
  const { channelId, channelTitle: initialTitle, channelAvatar: initialAvatar } =
    route.params || {};

  const [channelData, setChannelData] = useState<ChannelDetails | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(channelId));
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [continuationToken, setContinuationToken] = useState<string | undefined>(undefined);
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'videos' | 'playlists'>('videos');

  useEffect(() => {
    if (!channelId) {
      return;
    }

    // 1. Check local subscription status
    checkChannelSubscriptionStatus(channelId).then(sub => setIsSubscribed(sub)).catch(() => {});

    // 2. Fetch Live Channel Profile & Uploaded Videos
    fetchChannelDetailsDirect(channelId)
      .then(data => {
        if (data) {
          setChannelData(data);
          setContinuationToken(data.continuationToken);
        }
      })
      .catch(err => {
        console.warn('[ChannelScreen] fetchChannelDetailsDirect error caught:', err);
      })
      .finally(() => setLoading(false));
  }, [channelId]);

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !continuationToken || activeTab !== 'videos') return;

    setLoadingMore(true);
    try {
      const channelTitle = channelData?.title || initialTitle || 'Channel';
      const result = await fetchChannelMoreVideosDirect(continuationToken, channelTitle);
      if (result.videos.length > 0) {
        setChannelData(prev => {
          if (!prev) return prev;
          const existingIds = new Set(prev.videos.map(v => v.id));
          const newVideos = result.videos.filter(v => !existingIds.has(v.id));
          return {
            ...prev,
            videos: [...prev.videos, ...newVideos],
          };
        });
      }
      setContinuationToken(result.nextContinuationToken);
    } catch (e) {
      console.warn('Failed to load more channel videos:', e);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, continuationToken, activeTab, channelData, initialTitle]);

  const handleSubscribeToggle = async () => {
    const nextSub = !isSubscribed;
    setIsSubscribed(nextSub);
    const title = channelData?.title || initialTitle || 'Channel';
    const avatar = channelData?.avatar || initialAvatar;
    await toggleChannelSubscription(channelId, nextSub, title, avatar);
  };

  const renderVideoItem = ({ item }: { item: AppVideoItem }) => (
    <TouchableOpacity
      style={styles.videoCard}
      activeOpacity={0.8}
      onPress={() => {
        stopGlobalAudio();
        navigation.navigate('PlayerDetail', {
          videoId: item.id,
          title: item.title,
          author: item.author || channelData?.title || initialTitle,
        });
      }}
    >
      <View style={styles.thumbnailContainer}>
        <Image source={{ uri: item.thumbnail }} style={styles.thumbnail} contentFit="cover" />
        {item.duration ? (
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>{item.duration}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.videoInfo}>
        <Text style={styles.videoTitle} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.videoMeta}>
          {item.viewCount ? `${item.viewCount} ` : ''}
          {item.published ? `• ${item.published}` : ''}
        </Text>
      </View>
    </TouchableOpacity>
  );

  const renderPlaylistItem = ({ item }: { item: ChannelPlaylistItem }) => (
    <TouchableOpacity
      style={styles.playlistCard}
      activeOpacity={0.8}
      onPress={() => {
        stopGlobalAudio();
        navigation.navigate('PlayerDetail', {
          videoId: item.id,
          title: item.title,
          author: channelData?.title || initialTitle,
        });
      }}
    >
      <View style={styles.playlistThumbContainer}>
        {item.thumbnail ? (
          <Image source={{ uri: item.thumbnail }} style={styles.playlistThumbnail} contentFit="cover" />
        ) : (
          <View style={[styles.playlistThumbnail, styles.playlistPlaceholder]}>
            <Ionicons name="musical-notes" size={32} color="#888" />
          </View>
        )}
        <View style={styles.playlistOverlayBadge}>
          <Ionicons name="list" size={14} color="#FFF" />
          <Text style={styles.playlistCountText}>{item.videoCount || 'Playlist'}</Text>
        </View>
      </View>
      <View style={styles.playlistInfo}>
        <Text style={styles.playlistTitle} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.playlistSub}>Playlist • {channelData?.title || initialTitle}</Text>
      </View>
    </TouchableOpacity>
  );

  const channelTitle = channelData?.title || initialTitle || 'YouTube Channel';
  const avatarUrl = channelData?.avatar || initialAvatar;

  const renderHeader = () => (
    <View>
      {/* Channel Banner */}
      {channelData?.banner ? (
        <Image source={{ uri: channelData.banner }} style={styles.bannerImage} contentFit="cover" />
      ) : (
        <View style={styles.bannerPlaceholder} />
      )}

      {/* Profile Header */}
      <View style={styles.profileSection}>
        <View style={styles.avatarRow}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.channelAvatar} contentFit="cover" />
          ) : (
            <View style={[styles.channelAvatar, styles.avatarPlaceholder]}>
              <Ionicons name="person" size={36} color="#888" />
            </View>
          )}

          <View style={styles.headerInfo}>
            <Text style={styles.channelHeading} numberOfLines={1}>
              {channelTitle}
            </Text>
            <Text style={styles.statsText}>
              {channelData?.subscriberCount ? `${channelData.subscriberCount} ` : ''}
              {channelData?.videosCount ? `• ${channelData.videosCount}` : ''}
            </Text>
          </View>
        </View>

        {/* Description Preview */}
        {channelData?.description ? (
          <Text style={styles.channelDesc} numberOfLines={2}>
            {channelData.description}
          </Text>
        ) : null}

        {/* Subscribe Action Button */}
        <TouchableOpacity
          style={[styles.subButton, isSubscribed && styles.subButtonActive]}
          activeOpacity={0.8}
          onPress={handleSubscribeToggle}
        >
          <Ionicons
            name={isSubscribed ? 'checkmark-circle' : 'notifications-outline'}
            size={18}
            color={isSubscribed ? '#00E676' : '#000000'}
            style={{ marginRight: 6 }}
          />
          <Text style={[styles.subBtnLabel, isSubscribed && styles.subBtnLabelActive]}>
            {isSubscribed ? 'Subscribed' : 'Subscribe'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Tab Selector: Videos / Playlists */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'videos' && styles.tabItemActive]}
          onPress={() => setActiveTab('videos')}
        >
          <Text style={[styles.tabText, activeTab === 'videos' && styles.tabTextActive]}>
            Videos ({channelData?.videos?.length || 0})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'playlists' && styles.tabItemActive]}
          onPress={() => setActiveTab('playlists')}
        >
          <Text style={[styles.tabText, activeTab === 'playlists' && styles.tabTextActive]}>
            Playlists ({channelData?.playlists?.length || 0})
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Top Navigation Bar */}
      <View style={styles.topNav}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.navTitle} numberOfLines={1}>
          {channelTitle}
        </Text>
      </View>

      {loading ? (
        <View style={styles.centerLoading}>
          <ActivityIndicator size="large" color="#FF0000" />
          <Text style={styles.loadingText}>Loading Channel Profile...</Text>
        </View>
      ) : (
        <FlatList
          data={activeTab === 'videos' ? (channelData?.videos || []) : (channelData?.playlists || [])}
          keyExtractor={(item: any) => item.id}
          renderItem={activeTab === 'videos' ? (renderVideoItem as any) : (renderPlaylistItem as any)}
          ListHeaderComponent={renderHeader}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footerLoading}>
                <ActivityIndicator size="small" color="#FF0000" />
                <Text style={styles.footerLoadingText}>Loading more videos...</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            !loading ? (
              <View style={styles.emptyContainer}>
                <Ionicons
                  name={activeTab === 'videos' ? 'videocam-outline' : 'albums-outline'}
                  size={48}
                  color="#555"
                />
                <Text style={styles.emptyText}>
                  {activeTab === 'videos'
                    ? 'No videos found for this channel.'
                    : 'No public playlists found.'}
                </Text>
              </View>
            ) : null
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.6}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F0F',
  },
  topNav: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#222222',
  },
  backBtn: {
    padding: 6,
    marginRight: 8,
  },
  navTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    flex: 1,
  },
  centerLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#888888',
    fontSize: 13,
    marginTop: 10,
  },
  scrollView: {
    flex: 1,
  },
  bannerImage: {
    width: '100%',
    height: 110,
    backgroundColor: '#1E1E1E',
  },
  bannerPlaceholder: {
    width: '100%',
    height: 40,
    backgroundColor: '#1E1E1E',
  },
  profileSection: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#222222',
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  channelAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#2A2A2A',
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerInfo: {
    marginLeft: 14,
    flex: 1,
  },
  channelHeading: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  statsText: {
    color: '#AAAAAA',
    fontSize: 12,
    marginTop: 4,
  },
  channelDesc: {
    color: '#888888',
    fontSize: 12,
    marginTop: 10,
    lineHeight: 17,
  },
  subButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 9,
    borderRadius: 20,
    marginTop: 14,
  },
  subButtonActive: {
    backgroundColor: '#272727',
  },
  subBtnLabel: {
    color: '#000000',
    fontSize: 13,
    fontWeight: 'bold',
  },
  subBtnLabelActive: {
    color: '#FFFFFF',
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#222222',
  },
  tabItem: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: '#FF0000',
  },
  tabText: {
    color: '#888888',
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  listContent: {
    paddingVertical: 10,
  },
  videoCard: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  thumbnailContainer: {
    width: 140,
    height: 80,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#222222',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  durationBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  durationText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  videoInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  videoTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  videoMeta: {
    color: '#888888',
    fontSize: 11,
    marginTop: 4,
  },
  playlistCard: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  playlistThumbContainer: {
    width: 140,
    height: 80,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#222222',
  },
  playlistThumbnail: {
    width: '100%',
    height: '100%',
  },
  playlistPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  playlistOverlayBadge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 3,
  },
  playlistCountText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
    marginLeft: 4,
  },
  playlistInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  playlistTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  playlistSub: {
    color: '#888888',
    fontSize: 11,
    marginTop: 4,
  },
  emptyContainer: {
    paddingVertical: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#666666',
    fontSize: 13,
    marginTop: 10,
  },
  footerLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  footerLoadingText: {
    color: '#888888',
    fontSize: 12,
    marginLeft: 8,
  },
});
