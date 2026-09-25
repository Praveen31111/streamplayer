import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getDb } from './src/database/db';
import { initVideoCache } from './src/player/videoCache';
import { HomeScreen } from './src/screens/HomeScreen';
import { SubscriptionsScreen } from './src/screens/SubscriptionsScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { DownloadsScreen } from './src/screens/DownloadsScreen';
import { PlayerDetailScreen } from './src/screens/PlayerDetailScreen';
import { ChannelScreen } from './src/screens/ChannelScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function MainBottomTabs() {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0F0F0F',
          borderTopColor: '#222222',
          height: 56 + Math.max(insets.bottom, 8),
          paddingBottom: Math.max(insets.bottom, 8),
          paddingTop: 6,
        },
        tabBarActiveTintColor: '#FF0000',
        tabBarInactiveTintColor: '#888888',
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
        tabBarIcon: ({ color, size, focused }) => {
          let iconName: any = 'home';
          if (route.name === 'HomeTab') {
            iconName = focused ? 'home' : 'home-outline';
          } else if (route.name === 'SubscriptionsTab') {
            iconName = focused ? 'albums' : 'albums-outline';
          } else if (route.name === 'DownloadsTab') {
            iconName = focused ? 'download' : 'download-outline';
          } else if (route.name === 'LibraryTab') {
            iconName = focused ? 'time' : 'time-outline';
          }
          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="HomeTab" component={HomeScreen} options={{ tabBarLabel: 'Home' }} />
      <Tab.Screen
        name="SubscriptionsTab"
        component={SubscriptionsScreen}
        options={{ tabBarLabel: 'Subscriptions' }}
      />
      <Tab.Screen
        name="DownloadsTab"
        component={DownloadsScreen}
        options={{ tabBarLabel: 'Downloads' }}
      />
      <Tab.Screen name="LibraryTab" component={LibraryScreen} options={{ tabBarLabel: 'Library' }} />
    </Tab.Navigator>
  );
}

export default function App() {
  useEffect(() => {
    // 1. Initialize Local SQLite Database Tables on Launch
    getDb();
    // 2. Allocate 500MB High-Speed Video Disk Cache (SmartTube Architecture)
    initVideoCache(500);
  }, []);

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="light" />
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Main" component={MainBottomTabs} />
          <Stack.Screen
            name="PlayerDetail"
            component={PlayerDetailScreen}
            options={{ animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="Channel"
            component={ChannelScreen}
            options={{ animation: 'slide_from_right' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
