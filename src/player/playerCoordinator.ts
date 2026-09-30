/**
 * Global Player Coordinator
 * Ensures strictly at most ONE video player can play audio/video across the entire app.
 * Completely eliminates any audio overlap when navigating between screens or playing new videos.
 */

let activePlayerInstance: any = null;

export const registerActivePlayer = (player: any) => {
  if (activePlayerInstance && activePlayerInstance !== player) {
    try {
      activePlayerInstance.pause();
    } catch {}
  }
  activePlayerInstance = player;
};

export const unregisterActivePlayer = (player: any) => {
  if (activePlayerInstance === player) {
    try {
      player.pause();
    } catch {}
    activePlayerInstance = null;
  }
};

export const stopGlobalAudio = () => {
  if (activePlayerInstance) {
    try {
      activePlayerInstance.pause();
    } catch {}
    activePlayerInstance = null;
  }
};
