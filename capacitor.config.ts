import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lazypdf.app',
  appName: 'Lazy PDF',
  webDir: 'dist',
  server: {
    url: 'https://www.lazypdf.in',
    cleartext: true
  }
};

export default config;