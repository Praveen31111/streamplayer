import React, { useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
  Platform,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface AppSplashScreenProps {
  isReady: boolean;
  onFinish: () => void;
}

const { width } = Dimensions.get('window');

export const AppSplashScreen: React.FC<AppSplashScreenProps> = ({ isReady, onFinish }) => {
  const containerOpacity = useMemo(() => new Animated.Value(1), []);
  const containerScale = useMemo(() => new Animated.Value(1), []);
  const logoScale = useMemo(() => new Animated.Value(0.85), []);
  const logoOpacity = useMemo(() => new Animated.Value(0), []);
  const glowPulse = useMemo(() => new Animated.Value(0.6), []);
  const progressWidth = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    // 1. Initial entrance animation for logo and text
    Animated.parallel([
      Animated.spring(logoScale, {
        toValue: 1,
        friction: 6,
        tension: 40,
        useNativeDriver: true,
      }),
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();

    // 2. Continuous breathing glow loop
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowPulse, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(glowPulse, {
          toValue: 0.5,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    );
    glowLoop.start();

    // 3. Smooth progressive loading bar
    Animated.timing(progressWidth, {
      toValue: 1,
      duration: 1100,
      useNativeDriver: false,
    }).start();

    return () => glowLoop.stop();
  }, [glowPulse, logoOpacity, logoScale, progressWidth]);

  // When app resources are initialized and ready, smoothly fade out
  useEffect(() => {
    if (!isReady) return;

    // Small delay to ensure the smooth fill animation finishes gracefully
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(containerOpacity, {
          toValue: 0,
          duration: 350,
          useNativeDriver: true,
        }),
        Animated.timing(containerScale, {
          toValue: 1.05,
          duration: 350,
          useNativeDriver: true,
        }),
      ]).start(() => {
        onFinish();
      });
    }, 400);

    return () => clearTimeout(timer);
  }, [isReady, onFinish, containerOpacity, containerScale]);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: containerOpacity,
          transform: [{ scale: containerScale }],
        },
      ]}
      pointerEvents="box-none"
    >
      <StatusBar barStyle="light-content" backgroundColor="#0F0F0F" translucent={true} />

      {/* Ambient background glow circle */}
      <Animated.View
        style={[
          styles.ambientGlow,
          {
            opacity: glowPulse,
            transform: [{ scale: logoScale }],
          },
        ]}
      />

      <Animated.View
        style={[
          styles.content,
          {
            opacity: logoOpacity,
            transform: [{ scale: logoScale }],
          },
        ]}
      >
        {/* Sleek App Icon Container */}
        <View style={styles.iconContainer}>
          <View style={styles.iconGlowBackground} />
          <View style={styles.iconBadge}>
            <Ionicons name="play" size={38} color="#FFFFFF" style={styles.playIcon} />
          </View>
        </View>

        {/* App Title & Premium Subtitle */}
        <View style={styles.titleContainer}>
          <Text style={styles.title}>
            Stream<Text style={styles.titleHighlight}>Player</Text>
          </Text>
          <View style={styles.badgeRow}>
            <View style={styles.badgeDot} />
            <Text style={styles.badgeText}>PREMIUM AD-FREE</Text>
          </View>
        </View>
      </Animated.View>

      {/* Bottom Status & Smooth Progress Bar */}
      <View style={styles.bottomArea}>
        <View style={styles.progressBarTrack}>
          <Animated.View
            style={[
              styles.progressBarFill,
              {
                width: progressWidth.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '100%'],
                }),
              },
            ]}
          />
        </View>
        <Text style={styles.versionText}>Fast • Ad-Free • Background Play</Text>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#0F0F0F',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 99999,
  },
  ambientGlow: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(255, 0, 0, 0.12)',
    filter: Platform.OS === 'web' ? 'blur(40px)' : undefined,
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    width: 88,
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    position: 'relative',
  },
  iconGlowBackground: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 28,
    backgroundColor: 'rgba(255, 0, 0, 0.28)',
  },
  iconBadge: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: '#FF0000',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FF0000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 12,
  },
  playIcon: {
    marginLeft: 4,
  },
  titleContainer: {
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.8,
  },
  titleHighlight: {
    color: '#FF0000',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00E676',
    marginRight: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#E0E0E0',
    letterSpacing: 1.2,
  },
  bottomArea: {
    position: 'absolute',
    bottom: 50,
    alignItems: 'center',
    width: '100%',
  },
  progressBarTrack: {
    width: Math.min(width * 0.45, 180),
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#FF0000',
    borderRadius: 1.5,
  },
  versionText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#777777',
    letterSpacing: 0.5,
  },
});
