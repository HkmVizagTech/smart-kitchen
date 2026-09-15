import { useState } from "react";
import { SafeAreaView, StatusBar, Platform, View } from "react-native";
import { AuthedUser, Booking } from "./src/api";
import { colors } from "./src/theme";
import Login from "./src/screens/Login";
import Home from "./src/screens/Home";
import BookFlow from "./src/screens/BookFlow";
import Close from "./src/screens/Close";

type Screen = "home" | "book" | "close";

export default function App() {
  const [user, setUser] = useState<AuthedUser | null>(null);
  const [screen, setScreen] = useState<Screen>("home");
  const [closing, setClosing] = useState<Booking | null>(null);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
      <View
        style={{
          flex: 1,
          paddingTop: Platform.OS === "android" ? 24 : 0,
          maxWidth: 640,
          width: "100%",
          alignSelf: "center",
        }}
      >
        {!user ? (
          <Login onLogin={(u) => { setUser(u); setScreen("home"); }} />
        ) : screen === "book" ? (
          <BookFlow user={user} onDone={() => setScreen("home")} onCancel={() => setScreen("home")} />
        ) : screen === "close" && closing ? (
          <Close
            user={user}
            booking={closing}
            onDone={() => setScreen("home")}
            onCancel={() => setScreen("home")}
          />
        ) : (
          <Home
            user={user}
            onNewBooking={() => setScreen("book")}
            onCloseOut={(b) => {
              setClosing(b);
              setScreen("close");
            }}
            onLogout={() => setUser(null)}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
