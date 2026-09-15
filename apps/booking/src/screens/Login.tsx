import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { api, AuthedUser, LoginUser } from "../api";
import { s, colors } from "../theme";

export default function Login({ onLogin }: { onLogin: (u: AuthedUser) => void }) {
  const [users, setUsers] = useState<LoginUser[] | null>(null);
  const [selected, setSelected] = useState<LoginUser | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .users()
      .then(setUsers)
      .catch((e) => setError(e.message));
  }, []);

  async function doLogin() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const { user } = await api.login(selected.id, pin);
      onLogin(user);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Text style={s.h1}>Smart Kitchen</Text>
      <Text style={s.muted}>Sign in to place orders</Text>

      {!users && !error && <ActivityIndicator style={{ marginTop: 24 }} color={colors.primary} />}
      {error ? <Text style={s.error}>{error}</Text> : null}

      {users && (
        <View style={{ marginTop: 16 }}>
          <Text style={s.label}>WHO ARE YOU?</Text>
          {users.map((u) => (
            <Pressable
              key={u.id}
              style={[s.card, selected?.id === u.id && { borderColor: colors.primary, borderWidth: 2 }]}
              onPress={() => {
                setSelected(u);
                setPin("");
                setError("");
              }}
            >
              <Text style={{ fontWeight: "700", color: colors.text, fontSize: 16 }}>{u.name}</Text>
              <Text style={s.muted}>
                {u.role}
                {u.unit ? ` · ${u.unit.name}` : ""}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {selected && (
        <View style={{ marginTop: 8 }}>
          <Text style={s.label}>ENTER PIN</Text>
          <TextInput
            style={s.input}
            value={pin}
            onChangeText={setPin}
            placeholder="4-digit PIN"
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
          />
          <Pressable
            style={[s.btn, (busy || !pin) && s.btnDisabled]}
            disabled={busy || !pin}
            onPress={doLogin}
          >
            <Text style={s.btnText}>{busy ? "Signing in…" : "Sign in"}</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}
