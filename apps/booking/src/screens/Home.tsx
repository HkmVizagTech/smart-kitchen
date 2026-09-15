import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { api, AuthedUser, Booking } from "../api";
import { s, colors, statusColor } from "../theme";
import Header from "../components/Header";

const SESSION_LABEL: Record<string, string> = {
  BREAKFAST: "Morning Tiffin",
  LUNCH: "Lunch",
  DINNER: "Dinner",
};

function Badge({ status }: { status: string }) {
  const c = statusColor(status);
  return (
    <View style={[s.badge, { backgroundColor: c.bg }]}>
      <Text style={[s.badgeText, { color: c.fg }]}>{status}</Text>
    </View>
  );
}

export default function Home({
  user,
  onNewBooking,
  onCloseOut,
  onLogout,
}: {
  user: AuthedUser;
  onNewBooking: () => void;
  onCloseOut: (b: Booking) => void;
  onLogout: () => void;
}) {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    if (!user.unitId) return;
    try {
      setBookings(await api.myBookings(user.unitId));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const needsAttention = (bookings ?? []).filter((b) => b.needsCloseOut && b.status !== "CLOSED");

  return (
    <View style={s.screen}>
      <Header title="Smart Kitchen" subtitle={`${user.name} · Unit #${user.unitId}`} actionLabel="Sign out" onAction={onLogout} />
      <ScrollView
        contentContainerStyle={s.pad}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
      <Pressable style={[s.btn, { marginTop: 4 }]} onPress={onNewBooking}>
        <Text style={s.btnText}>＋  New Booking</Text>
      </Pressable>

      {error ? <Text style={s.error}>{error}</Text> : null}
      {!bookings && !error ? (
        <ActivityIndicator style={{ marginTop: 24 }} color={colors.primary} />
      ) : null}

      {needsAttention.length > 0 && (
        <>
          <Text style={s.h2}>Needs your attention</Text>
          {needsAttention.map((b) => (
            <View key={b.id} style={[s.card, { backgroundColor: colors.warnBg, borderColor: "#fde68a" }]}>
              <Text style={{ fontWeight: "800", color: colors.text }}>
                {SESSION_LABEL[b.session]} · {new Date(b.date).toDateString()}
              </Text>
              <Text style={[s.muted, { marginTop: 2 }]}>
                Submit consumption + feedback to unlock your next booking.
              </Text>
              <Pressable style={[s.btn, { marginTop: 10 }]} onPress={() => onCloseOut(b)}>
                <Text style={s.btnText}>Close out this meal</Text>
              </Pressable>
            </View>
          ))}
        </>
      )}

      {bookings && (
        <>
          <Text style={s.h2}>Your bookings</Text>
          {bookings.length === 0 && (
            <View style={s.card}>
              <Text style={s.muted}>No bookings yet. Tap “New Booking” to start.</Text>
            </View>
          )}
          {bookings.map((b) => (
            <View key={b.id} style={s.card}>
              <View style={s.rowBetween}>
                <Text style={{ fontWeight: "800", color: colors.text, fontSize: 15 }}>
                  {SESSION_LABEL[b.session]}
                  {b.isEmergency ? "  ⚡" : ""}
                </Text>
                <Badge status={b.status} />
              </View>
              <Text style={[s.muted, { marginTop: 4 }]}>{new Date(b.date).toDateString()}</Text>
              <Text style={{ color: colors.text, marginTop: 6 }}>
                {b.peopleCount ?? 0} people
                {b.item2Label ? ` · ${b.item2Label}` : ""}
              </Text>
              {b.consumptionStatus ? (
                <Text style={[s.muted, { marginTop: 4 }]}>Verification: {b.consumptionStatus}</Text>
              ) : null}
            </View>
          ))}
        </>
      )}
      </ScrollView>
    </View>
  );
}
