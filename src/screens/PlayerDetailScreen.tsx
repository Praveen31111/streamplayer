import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { CustomVideoPlayer, getPrewarmedStream, stopGlobalAudio } from '../player';
import {
  extractPlayableStream,
  PlayableStreamResult,
  fetchVideoComments,
  fetchRelatedVideos,
  VideoComment,
  AppVideoItem,
} from '../api';
import { rateVideo, toggleChannelSubscription, checkChannelSubscriptionStatus } from '../api/userService';
import { saveBookmark, deleteBookmark, isBookmarked } from '../database/repositories/bookmarkRepo';
import { downloadVideoForOffline } from '../downloader/downloadManager';

export const PlayerDetailScreen = ({ route, navigation }: any) => {
  const { videoId, title: initialTitle, author: initialAuthor, offlineUri } = route.params || {};

  const [streamData, setStreamData] = useState<PlayableStreamResult | null>(null);
  const [activeStreamUrl, setActiveStreamUrl] = useState<string>('');
  const [activeQuality, setActiveQuality] = useState<string>('720p');
  const [isLoading, setIsLoading] = useState<boolean>(!offlineUri);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [isDownloaded, setIsDownloaded] = useState<boolean>(!!offlineUri);
  const [isSavedBookmark, setIsSavedBookmark] = useState<boolean>(false);
  const [isLiked, setIsLiked] = useState<boolean>(false);
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState<boolean>(false);

  // Comments and Related Videos
  const [comments, setComments] = useState<VideoComment[]>([]);
  const [relatedVideos, setRelatedVideos] = useState<AppVideoItem[]>([]);
  const [activeDetailTab, setActiveDetailTab] = useState<'related' | 'comments'>('related');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  useEffect(() => {
    stopGlobalAudio();

    const initPlayer = async () => {
      if (offlineUri) {
        // Offline playback mode
        setStreamData({
          videoId: videoId,
          title: initialTitle || 'Offline Video',
          author: initialAuthor || 'Saved Offline',
          description: 'Playing from offline storage without internet.',
          durationSeconds: 0,
          thumbnailUrl: '',
          streamUrl: offlineUri,
          qualityLabel: 'Offline',
        });
        setActiveStreamUrl(offlineUri);
        setActiveQuality('Offline');
        setIsLoading(false);
        return;
      }

      // Check bookmark status
      isBookmarked(videoId).then(val => setIsSavedBookmark(val)).catch(() => {});

      // Instant Playback from Pre-warmed Memory Cache (if available)
      const prewarmed = getPrewarmedStream(videoId);
      if (prewarmed) {
        setStreamData(prewarmed);
        setActiveStreamUrl(prewarmed.streamUrl);
        setActiveQuality(prewarmed.qualityLabel || '720p');
        setIsLoading(false);
      } else {
        setIsLoading(true);
        // Live Stream Extraction
        try {
          const data = await extractPlayableStream(videoId);
          setStreamData(data);
          setActiveStreamUrl(data.streamUrl);
          setActiveQuality(data.qualityLabel || '720p');
          if (data?.channelId) {
            checkChannelSubscriptionStatus(data.channelId).then(sub => setIsSubscribed(sub)).catch(() => {});
          }
        } catch (err) {
          console.error('Extraction error:', err);
          Alert.alert('Playback Error', 'Unable to extract playable stream for this video.');
        } finally {
          setIsLoading(false);
        }
      }

      // Check prewarmed subscription status
      if (prewarmed?.channelId) {
        checkChannelSubscriptionStatus(prewarmed.channelId).then(sub => setIsSubscribed(sub)).catch(() => {});
      }

      // Fetch comments and related videos
      fetchVideoComments(videoId).then(c => setComments(c)).catch(() => {});
      fetchRelatedVideos(videoId, initialTitle).then(r => setRelatedVideos(r)).catch(() => {});
    };

    initPlayer();

    return () => {
      stopGlobalAudio();
    };
  }, [videoId, offlineUri, initialTitle, initialAuthor]);

  const handleQualityChange = (_url: string, label: string) => {
    // Quality change is handled natively inside CustomVideoPlayer with exact timestamp lock.
    // We only update the quality label badge to prevent parent re-renders from re-initializing the player.
    setActiveQuality(label);
  };

  const handlePlayNextVideo = () => {
    if (relatedVideos.length > 0) {
      const next = relatedVideos[0];
      navigation.replace('PlayerDetail', {
        videoId: next.id,
        title: next.title,
        author: next.author,
        thumbnailUrl: next.thumbnail,
      });
    }
  };

  const handleDownload = async () => {
    const downloadSource =
      streamData?.downloadUrl ||
      (!activeStreamUrl.endsWith('.mpd') ? activeStreamUrl : '') ||
      (!streamData?.streamUrl.endsWith('.mpd') ? streamData?.streamUrl : '') ||
      '';

    try {
      setDownloadProgress(0.01);
      await downloadVideoForOffline(
        videoId,
        streamData?.title || initialTitle || 'Video',
        downloadSource,
        progress => {
          setDownloadProgress(progress);
        }
      );
      setDownloadProgress(null);
      setIsDownloaded(true);
      Alert.alert('Success', 'Video saved offline successfully! You can watch it anytime in the Downloads tab.');
    } catch (err: any) {
      setDownloadProgress(null);
      Alert.alert('Download Error', err?.message || 'Could not complete the download.');
    }
  };

  const handleToggleBookmark = async () => {
    if (!streamData) return;
    if (isSavedBookmark) {
      await deleteBookmark(videoId);
      setIsSavedBookmark(false);
    } else {
      await saveBookmark(videoId, streamData.title, streamData.author, streamData.thumbnailUrl);
      setIsSavedBookmark(true);
      Alert.alert('Saved', 'Added to saved bookmarks!');
    }
  };

  const handleLike = async () => {
    const nextState = !isLiked;
    setIsLiked(nextState);
    await rateVideo(videoId, nextState ? 'LIKE' : 'INDIFFERENT');
  };

  const handleSubscribe = async () => {
    if (!streamData?.channelId) return;
    const nextState = !isSubscribed;
    setIsSubscribed(nextState);
    await toggleChannelSubscription(
      streamData.channelId,
      nextState,
      streamData.author,
      streamData.authorAvatar
    );
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Watch "${streamData?.title || initialTitle}": https://youtube.com/watch?v=${videoId}`,
      });
    } catch {
      // Ignored
    }
  };

  return (
    <SafeAreaView style={[styles.container, isFullscreen && { padding: 0 }]} edges={isFullscreen ? [] : ['top', 'bottom']}>
      {/* Media Player Area */}
      {isLoading ? (
        <View style={styles.playerLoading}>
          <ActivityIndicator size="large" color="#FF0000" />
          <Text style={styles.loadingText}>Extracting Video Stream...</Text>
        </View>
      ) : activeStreamUrl ? (
        <CustomVideoPlayer
          key={videoId}
          videoId={videoId}
          streamUrl={activeStreamUrl}
          audioStreamUrl={streamData?.audioStreamUrl}
          title={streamData?.title || initialTitle || ''}
          author={streamData?.author || initialAuthor || ''}
          thumbnailUrl={streamData?.thumbnailUrl || ''}
          qualityLabel={activeQuality}
          availableQualities={streamData?.availableQualities}
          rawVideoFormats={streamData?.rawVideoFormats}
          rawAudioFormats={streamData?.rawAudioFormats}
          audioTracks={streamData?.audioTracks}
          activeAudioTrackId={streamData?.activeAudioTrackId}
          captionTracks={streamData?.captionTracks}
          userAgent={streamData?.clientUserAgent}
          durationSeconds={streamData?.durationSeconds}
          onQualityChange={handleQualityChange}
          onFullscreenChange={setIsFullscreen}
          onClose={() => navigation.goBack()}
          nextVideo={relatedVideos.length > 0 ? relatedVideos[0] : null}
          onPlayNextVideo={handlePlayNextVideo}
        />
      ) : (
        <View style={styles.playerLoading}>
          <Ionicons name="alert-circle-outline" size={40} color="#FF5252" />
          <Text style={styles.loadingText}>Stream unavailable</Text>
        </View>
      )}

      {/* Video Details & Actions (Hidden in Fullscreen mode) */}
      {!isFullscreen && (
        <ScrollView style={styles.scrollDetails} contentContainerStyle={{ paddingBottom: 50 }}>
        {streamData && (
          <View style={styles.infoBox}>
            <Text style={styles.title}>{streamData.title}</Text>
            <Text style={styles.viewsInfo}>
              {streamData.views ? `${streamData.views} views` : ''}
              {streamData.published ? ` • ${streamData.published}` : ''}
            </Text>

            {/* Action Buttons Row */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionRow}>
              <TouchableOpacity
                style={[styles.actionBtn, isDownloaded && styles.actionBtnActive]}
                onPress={handleDownload}
                disabled={isDownloaded || downloadProgress !== null}
              >
                <Ionicons
                  name={isDownloaded ? 'checkmark-circle' : 'download-outline'}
                  size={18}
                  color={isDownloaded ? '#00E676' : '#FFF'}
                />
                <Text style={[styles.actionText, isDownloaded && { color: '#00E676' }]}>
                  {downloadProgress !== null
                    ? `${Math.round(downloadProgress * 100)}%`
                    : isDownloaded
                    ? 'Saved'
                    : 'Download'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, isLiked && styles.actionBtnActive]}
                onPress={handleLike}
              >
                <Ionicons name={isLiked ? 'thumbs-up' : 'thumbs-up-outline'} size={18} color={isLiked ? '#00E676' : '#FFF'} />
                <Text style={[styles.actionText, isLiked && { color: '#00E676' }]}>Like</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, isSavedBookmark && styles.actionBtnActive]}
                onPress={handleToggleBookmark}
              >
                <Ionicons name={isSavedBookmark ? 'bookmark' : 'bookmark-outline'} size={18} color={isSavedBookmark ? '#FFD700' : '#FFF'} />
                <Text style={[styles.actionText, isSavedBookmark && { color: '#FFD700' }]}>Save</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.actionBtn} onPress={handleShare}>
                <Ionicons name="share-social-outline" size={18} color="#FFF" />
                <Text style={styles.actionText}>Share</Text>
              </TouchableOpacity>
            </ScrollView>

            {/* Channel Info Row - Clicking opens Channel Profile */}
            <View style={styles.channelRow}>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
                activeOpacity={0.7}
                onPress={() => {
                  if (streamData.channelId) {
                    stopGlobalAudio();
                    navigation.navigate('Channel', {
                      channelId: streamData.channelId,
                      channelTitle: streamData.author,
                      channelAvatar: streamData.authorAvatar,
                    });
                  }
                }}
              >
                {streamData.authorAvatar ? (
                  <Image source={{ uri: streamData.authorAvatar }} style={styles.avatarImage} />
                ) : (
                  <View style={styles.avatar}>
                    <Ionicons name="person" size={20} color="#888" />
                  </View>
                )}
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={styles.channelName}>{streamData.author}</Text>
                    <Ionicons name="chevron-forward" size={14} color="#888" style={{ marginLeft: 4 }} />
                  </View>
                  <Text style={styles.channelSub}>View Channel Profile</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.subscribeBtn, isSubscribed && styles.subscribeBtnActive]}
                onPress={handleSubscribe}
              >
                <Text style={[styles.subBtnText, isSubscribed && styles.subBtnTextActive]}>
                  {isSubscribed ? 'Subscribed' : 'Subscribe'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Description Box */}
            {streamData.description ? (
              <TouchableOpacity
                style={styles.descBox}
                onPress={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                activeOpacity={0.7}
              >
                <Text style={styles.descTitle}>Description</Text>
                <Text
                  style={styles.descText}
                  numberOfLines={isDescriptionExpanded ? undefined : 3}
                >
                  {streamData.description}
                </Text>
                <Text style={styles.moreText}>
                  {isDescriptionExpanded ? 'Show less' : 'Show more...'}
                </Text>
              </TouchableOpacity>
            ) : null}

            {/* Sub-Tabs: Related vs Comments */}
            <View style={styles.subTabBar}>
              <TouchableOpacity
                style={[styles.subTabItem, activeDetailTab === 'related' && styles.subTabItemActive]}
                onPress={() => setActiveDetailTab('related')}
              >
                <Text style={[styles.subTabText, activeDetailTab === 'related' && styles.subTabTextActive]}>
                  Related Videos ({relatedVideos.length})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.subTabItem, activeDetailTab === 'comments' && styles.subTabItemActive]}
                onPress={() => setActiveDetailTab('comments')}
              >
                <Text style={[styles.subTabText, activeDetailTab === 'comments' && styles.subTabTextActive]}>
                  Comments ({comments.length})
                </Text>
              </TouchableOpacity>
            </View>

            {/* Sub-Tab Content */}
            {activeDetailTab === 'related' ? (
              <View style={styles.relatedList}>
                {relatedVideos.map((item, idx) => (
                  <TouchableOpacity
                    key={item.id || idx}
                    style={styles.relatedCard}
                    activeOpacity={0.8}
                    onPress={() =>
                      navigation.replace('PlayerDetail', {
                        videoId: item.id,
                        title: item.title,
                        author: item.author,
                        thumbnailUrl: item.thumbnail,
                      })
                    }
                  >
                    <Image source={{ uri: item.thumbnail }} style={styles.relatedThumb} contentFit="cover" />
                    <View style={styles.relatedMeta}>
                      <Text style={styles.relatedTitle} numberOfLines={2}>{item.title}</Text>
                      <Text style={styles.relatedAuthor}>{item.author}</Text>
                      <Text style={styles.relatedViews}>{item.viewCount || ''}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <View style={styles.commentsList}>
                {comments.length === 0 ? (
                  <Text style={styles.emptyComments}>No comments loaded</Text>
                ) : (
                  comments.map(c => (
                    <View key={c.id} style={styles.commentItem}>
                      <View style={styles.commentAvatar}>
                        <Ionicons name="person-circle" size={28} color="#888" />
                      </View>
                      <View style={styles.commentBody}>
                        <Text style={styles.commentAuthor}>{c.author} {c.published ? `• ${c.published}` : ''}</Text>
                        <Text style={styles.commentText}>{c.text}</Text>
                      </View>
                    </View>
                  ))
                )}
              </View>
            )}
          </View>
        )}
      </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F0F' },
  playerLoading: {
    width: '100%',
    height: 240,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  loadingText: { color: '#888', fontSize: 13 },
  scrollDetails: { flex: 1 },
  infoBox: { padding: 14 },
  title: { color: '#FFF', fontSize: 16, fontWeight: '700', lineHeight: 22 },
  viewsInfo: { color: '#888', fontSize: 12, marginTop: 4 },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginVertical: 14,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#222',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  actionBtnActive: {
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
    borderWidth: 1,
    borderColor: '#00E676',
  },
  actionText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#222',
    gap: 12,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#282828',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImage: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  channelName: { color: '#FFF', fontSize: 14, fontWeight: 'bold' },
  channelSub: { color: '#888', fontSize: 11, marginTop: 2 },
  subscribeBtn: {
    backgroundColor: '#FF0000',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
  },
  subscribeBtnActive: {
    backgroundColor: '#333',
  },
  subBtnText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  subBtnTextActive: { color: '#AAA' },
  descBox: {
    backgroundColor: '#1C1C1C',
    borderRadius: 8,
    padding: 12,
    marginTop: 14,
    gap: 6,
  },
  descTitle: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  descText: { color: '#AAA', fontSize: 12, lineHeight: 18 },
  moreText: { color: '#FFF', fontSize: 12, fontWeight: '600', marginTop: 4 },
  subTabBar: {
    flexDirection: 'row',
    marginTop: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  subTabItem: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  subTabItemActive: {
    borderBottomColor: '#FF0000',
  },
  subTabText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
  },
  subTabTextActive: {
    color: '#FFF',
    fontWeight: '700',
  },
  relatedList: {
    marginTop: 12,
    gap: 12,
  },
  relatedCard: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#161616',
    borderRadius: 8,
    overflow: 'hidden',
  },
  relatedThumb: {
    width: 120,
    height: 70,
    backgroundColor: '#222',
  },
  relatedMeta: {
    flex: 1,
    justifyContent: 'center',
    paddingRight: 8,
  },
  relatedTitle: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
  relatedAuthor: {
    color: '#888',
    fontSize: 11,
    marginTop: 3,
  },
  relatedViews: {
    color: '#666',
    fontSize: 10,
    marginTop: 2,
  },
  commentsList: {
    marginTop: 12,
    gap: 12,
  },
  emptyComments: {
    color: '#666',
    fontSize: 13,
    textAlign: 'center',
    padding: 20,
  },
  commentItem: {
    flexDirection: 'row',
    gap: 10,
  },
  commentAvatar: {
    width: 28,
  },
  commentBody: {
    flex: 1,
  },
  commentAuthor: {
    color: '#AAA',
    fontSize: 11,
    fontWeight: '600',
  },
  commentText: {
    color: '#DDD',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
});
