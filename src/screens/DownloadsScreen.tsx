import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getCompletedDownloads, deleteDownloadedVideo, DownloadItem } from '../downloader/downloadManager';

export const DownloadsScreen = ({ navigation }: any) => {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const loadDownloads = async () => {
    setIsLoading(true);
    try {
      const data = await getCompletedDownloads();
      setDownloads(data || []);
    } catch (err) {
      console.warn('[DownloadsScreen] loadDownloads error caught:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadDownloads();
    });
    return unsubscribe;
  }, [navigation]);

  const handleDelete = (item: DownloadItem) => {
    Alert.alert(
      'Delete Download',
      `Are you sure you want to remove "${item.title}" from offline storage?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteDownloadedVideo(item.videoId, item.localUri);
            loadDownloads();
          },
        },
      ]
    );
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes) return 'Unknown Size';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const renderItem = ({ item }: { item: DownloadItem }) => (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.cardContent}
        onPress={() =>
          navigation.navigate('PlayerDetail', {
            videoId: item.videoId,
            title: item.title,
            offlineUri: item.localUri,
          })
        }
      >
        <View style={styles.iconBox}>
          <Ionicons name="film-outline" size={28} color="#FF0000" />
        </View>

        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
          <Text style={styles.subText}>{item.quality} • {formatFileSize(item.fileSizeBytes)}</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => handleDelete(item)} style={styles.deleteBtn}>
        <Ionicons name="trash-outline" size={20} color="#FF5252" />
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Offline Downloads</Text>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#FF0000" />
        </View>
      ) : (
        <FlatList
          data={downloads}
          keyExtractor={item => item.videoId}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="download-outline" size={54} color="#444" />
              <Text style={styles.emptyTitle}>No offline downloads</Text>
              <Text style={styles.emptySub}>
                Videos you download will appear here for playback without internet.
              </Text>
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
    borderBottomWidth: 1,
    borderBottomColor: '#252525',
  },
  headerTitle: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30, gap: 8 },
  list: { padding: 12 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    marginBottom: 10,
    padding: 10,
  },
  cardContent: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 6,
    backgroundColor: '#262626',
    justifyContent: 'center',
    alignItems: 'center',
  },
  info: { flex: 1 },
  title: { color: '#FFF', fontSize: 13, fontWeight: '600' },
  subText: { color: '#888', fontSize: 11, marginTop: 4 },
  deleteBtn: { padding: 10 },
  emptyTitle: { color: '#FFF', fontSize: 16, fontWeight: 'bold', marginTop: 12 },
  emptySub: { color: '#888', fontSize: 13, textAlign: 'center', lineHeight: 18 },
});
