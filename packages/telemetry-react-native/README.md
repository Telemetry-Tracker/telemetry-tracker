# @telemetry-tracker/react-native

React Native SDK: errors, sessions and screen tracking. Part of [Telemetry Tracker](https://telemetry-tracker.com), open-source error tracking and product analytics.

## Install

```bash
npm i @telemetry-tracker/react-native
```

## Quick start

```tsx
import { Platform } from "react-native";
import { init, trackScreen } from "@telemetry-tracker/react-native";

init({
  ingestUrl: "https://api.telemetry-tracker.com",
  app: "my-mobile-app",
  apiKey: "tt_live_<publicId>_<secret>",
  platform: Platform.OS === "ios" ? "ios" : "android",
});

trackScreen("Home");
```

Full guide: [sdk-react-native.md](https://github.com/Telemetry-Tracker/telemetry-tracker/blob/main/docs/sdk-react-native.md)

License: see the [repository](https://github.com/Telemetry-Tracker/telemetry-tracker).
