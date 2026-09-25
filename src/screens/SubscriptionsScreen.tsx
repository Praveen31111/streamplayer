import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Linking,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { AppVideoItem } from '../api/youtubeClient';
import { fetchUserSubscriptionsFeed } from '../api/userService';
import { getSubscribedChannels, SubscribedChannelItem } from '../database/repositories/subscriptionRepo';
import { startGoogleSignIn, signOutGoogle, checkIsLoggedIn, AuthPromptData } from '../auth/authService';

export const SubscriptionsScreen = ({ navigation }: any) => {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [channels, setChannels] = useState<SubscribedChannelItem[]>([]);
  const [videos, setVideos] = useState<AppVideoItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  
  // Auth Prompt Modal State
  const [authData, setAuthData] = useState<AuthPromptData | null>(null);
  const [isAuthModalVisible, setIsAuthModalVisible] = useState<boolean>(false);

  const checkAuthAndLoad = async () => {
    setIsLoading(true);
    const loggedIn = await checkIsLoggedIn();
    setIsLoggedIn(loggedIn);

    const localChannels = await getSubscribedChannels();
    setChannels(localChannels);

    const feed = await fetchUserSubscriptionsFeed();
    setVideos(feed);
    setIsLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- auth check on mount is standard React pattern
    void checkAuthAndLoad();
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    const localChannels = await getSubscribedChannels();
    setChannels(localChannels);
    const feed = await fetchUserSubscriptionsFeed();
    setVideos(feed);
    setIsRefreshing(false);
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
        checkAuthAndLoad();
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
    await checkAuthAndLoad();
  };

  const renderChannelAvatar = (channel: SubscribedChannelItem) => (
    <TouchableOpacity
      key={channel.channelId}
      style={styles.channelItem}
      activeOpacity={0.7}
      onPress={() => {
        // Filter videos for selected channel or show channel updates
        const filtered = videos.filter(v => v.channelId === channel.channelId || v.author === channel.channelName);
        if (filtered.length > 0) {
          setVideos(filtered);
        }
      }}
    >
      <View style={styles.channelAvatarRing}>
        {channel.avatarUrl ? (
          <Image source={{ uri: channel.avatarUrl }} style={styles.channelAvatarImg} />
        ) : (
          <Ionicons name="person-circle" size={48} color="#FF0000" />
        )}
      </View>
      <Text style={styles.channelNameText} numberOfLines={1}>
        {channel.channelName}
      </Text>
    </TouchableOpacity>
  );

  const renderVideoItem = ({ item }: { item: AppVideoItem }) => (
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
        >
          {item.authorAvatar ? (
            <Image source={{ uri: item.authorAvatar }} style={styles.avatar} />
          ) : (
            <Ionicons name="person-circle" size={36} color="#666" />
          )}
        </TouchableOpacity>

        <View style={styles.metaContainer}>
          <Text style={styles.title} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={styles.channelText}>
            {item.author} {item.published ? `• ${item.published}` : ''} {item.viewCount ? `• ${item.viewCount}` : ''}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const hasContent = videos.length > 0 || channels.length > 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="albums" size={22} color="#FF0000" />
          <Text style={styles.headerTitle}>Subscriptions</Text>
        </View>
        {isLoggedIn ? (
          <TouchableOpacity onPress={handleSignOut} style={styles.signOutBtn}>
            <Ionicons name="log-out-outline" size={18} color="#FF5252" />
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={handleLoginPress} style={styles.signInHeaderBtn}>
            <Ionicons name="logo-google" size={14} color="#FFF" />
            <Text style={styles.signInHeaderText}>Sign In</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Main Content */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#FF0000" />
        </View>
      ) : !hasContent && !isLoggedIn ? (
        <View style={styles.authBanner}>
          <Ionicons name="logo-youtube" size={54} color="#FF0000" />
          <Text style={styles.authTitle}>Your Subscriptions</Text>
          <Text style={styles.authSubtitle}>
            Subscribe to your favorite channels while watching videos or sign in with your Google account to sync feeds.
          </Text>

          <TouchableOpacity style={styles.googleBtn} onPress={handleLoginPress}>
            <Ionicons name="logo-google" size={20} color="#000" />
            <Text style={styles.googleBtnText}>Sign In with Google</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={videos}
          keyExtractor={(item, index) => item.id || index.toString()}
          renderItem={renderVideoItem}
          ListHeaderComponent={
            channels.length > 0 ? (
              <View style={styles.channelsBarContainer}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.channelsScrollContent}
                >
                  <TouchableOpacity
                    style={styles.allChannelsBtn}
                    onPress={handleRefresh}
                  >
                    <View style={styles.allChannelsIcon}>
                      <Ionicons name="grid-outline" size={20} color="#FFF" />
                    </View>
                    <Text style={styles.channelNameText}>All</Text>
                  </TouchableOpacity>
                  {channels.map(renderChannelAvatar)}
                </ScrollView>
              </View>
            ) : null
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
              <Ionicons name="albums-outline" size={48} color="#555" />
              <Text style={styles.emptyText}>No recent subscription updates</Text>
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
                  Enter this code on Google verification page:
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
                <Text style={styles.waitingText}>Waiting for confirmation...</Text>
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
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  signOutBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  signOutText: { color: '#FF5252', fontSize: 13, fontWeight: '600' },
  signInHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#272727',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  signInHeaderText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  channelsBarContainer: {
    borderBottomWidth: 1,
    borderBottomColor: '#222222',
    backgroundColor: '#141414',
    paddingVertical: 10,
  },
  channelsScrollContent: { paddingHorizontal: 12, gap: 14, alignItems: 'center' },
  channelItem: { alignItems: 'center', width: 62 },
  channelAvatarRing: {
    width: 52,
    height: 52,
    borderRadius: 26,
    padding: 2,
    borderWidth: 1.5,
    borderColor: '#FF0000',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#222',
  },
  channelAvatarImg: { width: '100%', height: '100%', borderRadius: 24 },
  channelNameText: {
    color: '#CCC',
    fontSize: 11,
    marginTop: 4,
    textAlign: 'center',
    maxWidth: 58,
  },
  allChannelsBtn: { alignItems: 'center', width: 56 },
  allChannelsIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#2A2A2A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: { marginBottom: 16 },
  thumbnailWrapper: { width: '100%', height: 215, backgroundColor: '#202020', position: 'relative' },
  thumbnail: { width: '100%', height: '100%' },
  durationBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  durationText: { color: '#FFF', fontSize: 11, fontWeight: '600' },
  detailsRow: { flexDirection: 'row', padding: 12, gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  metaContainer: { flex: 1 },
  title: { color: '#FFF', fontSize: 14, fontWeight: '600', lineHeight: 18 },
  channelText: { color: '#AAA', fontSize: 12, marginTop: 4 },
  emptyText: { color: '#777', fontSize: 14, marginTop: 10 },
  authBanner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
    gap: 12,
  },
  authTitle: { color: '#FFF', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  authSubtitle: { color: '#999', fontSize: 13, textAlign: 'center', lineHeight: 18 },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    gap: 10,
    marginTop: 10,
  },
  googleBtnText: { color: '#000', fontSize: 14, fontWeight: '600' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#212121',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  modalTitle: { color: '#FFF', fontSize: 20, fontWeight: 'bold', marginTop: 12 },
  modalSub: { color: '#BBB', fontSize: 14, textAlign: 'center', marginTop: 8 },
  codeBox: {
    backgroundColor: '#333',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginVertical: 16,
  },
  codeText: { color: '#FFF', fontSize: 24, fontWeight: 'bold', letterSpacing: 4 },
  openUrlBtn: {
    backgroundColor: '#FF0000',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
    width: '100%',
    alignItems: 'center',
  },
  openUrlBtnText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  waitingText: { color: '#888', fontSize: 12, marginTop: 12 },
  cancelBtn: { marginTop: 16, padding: 8 },
  cancelText: { color: '#AAA', fontSize: 14 },
});
