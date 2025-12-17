const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Force single React version resolution to fix ReactCurrentDispatcher error
// See: https://docs.expo.dev/guides/customizing-metro/
config.resolver.extraNodeModules = {
  react: path.resolve(__dirname, 'node_modules/react'),
  'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
};

// Block duplicate React copies from nested node_modules
config.resolver.blockList = [
  /node_modules\/.*\/node_modules\/react\//,
  /node_modules\/.*\/node_modules\/react-dom\//,
];

module.exports = config;
