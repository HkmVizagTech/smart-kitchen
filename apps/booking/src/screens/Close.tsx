import { useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView } from "react-native";
import { api, AuthedUser, Booking } from "../api";
import { s, colors } from "../theme";
import Header from "../components/Header";

const SESSION_LABEL: Record<string, string> = {
  BREAKFAST: "Morning Tiffin",
  LUNCH: "Lunch",
  DINNER: "Dinner",
};

export default function Close({
  booking,
  onDone,
  onCancel,
}: {
  user: AuthedUser;
  booking: Booking;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [received, setReceived] = useState(String(booking.peopleCount ?? ""));
  const [consumed, setConsumed] = useState("");
  const [leftover, setLeftover] = useState("");
  const [notes, setNotes] = useState("");
  const [taste, setTaste] = useState(0);
  const [quality, setQuality] = useState(0);
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  // auto-fill leftover = received - consumed when both present
  function onConsumed(v: string) {
    setConsumed(v);
    const r = Number(received);
    const c = Number(v);
    if (r && !isNaN(c) && r >= c) setLeftover(String(r - c));
  }

  async function submit() {
    if (!taste || !quality) {
      setError("Feedback is required: rate taste and quality.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.submitConsumption({
        orderId: booking.id,
        receivedQty: Number(received) || 0,
        consumedQty: Number(consumed) || 0,
        leftoverQty: Number(leftover) || 0,
        notes,
        taste,
        quality,
        remarks,
      });
      setOk("Submitted! Sent to the kitchen for verification.");
      setTimeout(onDone, 900);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.screen}>
      <Header
        title="Close out meal"
        subtitle={`${SESSION_LABEL[booking.session]} · ${new Date(booking.date).toDateString()}`}
        actionLabel="Cancel"
        onAction={onCancel}
      />
      <ScrollView contentContainerStyle={s.pad}>
        <Text style={s.h2}>1 · Consumption</Text>
        <Text style={s.muted}>Plates for this meal (received → consumed → leftover).</Text>
        <View style={s.card}>
          <QtyField label="Received (plates)" value={received} onChange={setReceived} />
          <QtyField label="Consumed (plates)" value={consumed} onChange={onConsumed} />
          <QtyField label="Leftover (plates)" value={leftover} onChange={setLeftover} />
          <Text style={s.label}>NOTES (OPTIONAL)</Text>
          <TextInput
            style={[s.input, { height: 64, fontSize: 15 }]}
            value={notes}
            onChangeText={setNotes}
            placeholder="anything to note for the kitchen"
            multiline
          />
        </View>

        <Text style={s.h2}>2 · Feedback (required)</Text>
        <View style={s.card}>
          <Stars label="Taste" value={taste} onChange={setTaste} />
          <Stars label="Quality" value={quality} onChange={setQuality} />
          <Text style={[s.label, { marginTop: 6 }]}>REMARKS (OPTIONAL)</Text>
          <TextInput
            style={[s.input, { height: 64, fontSize: 15 }]}
            value={remarks}
            onChangeText={setRemarks}
            placeholder="taste / quality comments"
            multiline
          />
        </View>

        <Pressable style={[s.btn, busy && s.btnDisabled]} disabled={busy} onPress={submit}>
          <Text style={s.btnText}>{busy ? "Submitting…" : "Submit & unlock next booking"}</Text>
        </Pressable>
        {error ? <Text style={s.error}>{error}</Text> : null}
        {ok ? <Text style={s.ok}>{ok}</Text> : null}
      </ScrollView>
    </View>
  );
}

function QtyField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.label}>{label.toUpperCase()}</Text>
      <TextInput
        style={s.input}
        value={value}
        onChangeText={(t) => onChange(t.replace(/[^0-9]/g, ""))}
        keyboardType="number-pad"
        placeholder="0"
      />
    </View>
  );
}

function Stars({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={s.label}>{label.toUpperCase()}</Text>
      <View style={s.rowWrap}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} style={[s.chip, value === n && s.chipActive]} onPress={() => onChange(n)}>
            <Text style={[s.chipText, value === n && s.chipTextActive]}>{n}★</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
