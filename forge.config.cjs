module.exports = {
  packagerConfig: {
    asar: true,
    icon: 'assets/icon.ico',
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        authors: 'Velto',
        setupExe: 'VeltoSetup.exe',
        setupIcon: 'assets/icon.ico',
        // Squirrel has no wizard; this animation is the only feedback shown while it installs.
        loadingGif: 'assets/installing.gif',
      },
    },
  ],
};
