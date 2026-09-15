import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.akshayapatra.booking",
  appName: "AP Booking",
  webDir: "dist",
  android: { allowMixedContent: false },
  plugins: {
    CapacitorUpdater: { autoUpdate: false, appReadyTimeout: 600000, responseTimeout: 60 },
  },
};

export default config;
