import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { api, AuthedUser, Item2Option, MenuResponse } from "../api";
import { s, colors } from "../theme";
import { dayEnum, prettyDate, today, tomorrow, ymd } from "../util";
import Header from "../components/Header";

type Meal = "TIFFIN" | "DINNER" | "LUNCH" | "EMERGENCY";
type Step = "meal" | "emgMeal" | "menu" | "count" | "review" | "done";

const MEALS: { key: Meal; title: string; sub: string }[] = [
  { key: "TIFFIN", title: "Morning Tiffin", sub: "For tomorrow · choose menu" },
  { key: "DINNER", title: "Dinner", sub: "For tomorrow · choose menu" },
  { key: "LUNCH", title: "Lunch", sub: "For today · before 11:00 AM · count only" },
  { key: "EMERGENCY", title: "Emergency Order", sub: "For today · count only · needs approval" },
];

const SESSION_OF: Record<Exclude<Meal, "EMERGENCY">, "BREAKFAST" | "LUNCH" | "DINNER"> = {
  TIFFIN: "BREAKFAST",
  DINNER: "DINNER",
  LUNCH: "LUNCH",
};

export default function BookFlow({
  user,
  onDone,
  onCancel,
}: {
  user: AuthedUser;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>("meal");
  const [meal, setMeal] = useState<Meal | null>(null);
  const [emgSession, setEmgSession] = useState<"BREAKFAST" | "LUNCH" | "DINNER">("LUNCH");
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [item2Id, setItem2Id] = useState<number | null>(null);
  const [count, setCount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const usesMenu = meal === "TIFFIN" || meal === "DINNER";
  const targetDate = meal === "LUNCH" || meal === "EMERGENCY" ? today() : tomorrow();
  const sessionForApi: "BREAKFAST" | "LUNCH" | "DINNER" =
    meal === "EMERGENCY" ? emgSession : meal ? SESSION_OF[meal] : "BREAKFAST";

  function pickMeal(m: Meal) {
    setMeal(m);
    setError("");
    setMenu(null);
    setItem2Id(null);
    if (m === "EMERGENCY") setStep("emgMeal");
    else if (m === "TIFFIN" || m === "DINNER") setStep("menu");
    else setStep("count");
  }

  // load menu when entering menu step
  useEffect(() => {
    if (step !== "menu" || !usesMenu) return;
    setMenu(null);
    api
      .menu(dayEnum(tomorrow()), sessionForApi)
      .then((m) => {
        setMenu(m);
        setItem2Id(m.template?.defaultItem2?.id ?? m.item2Options[0]?.id ?? null);
      })
      .catch((e) => setError(e.message));
  }, [step]);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      if (!user.unitId) throw new Error("Your account has no unit assigned.");
      const n = Number(count) || 0;
      let body: Record<string, unknown>;
      if (usesMenu) {
        body = {
          unitId: user.unitId,
          date: ymd(targetDate),
          session: sessionForApi,
          item2OptionId: item2Id,
          idlyPlates: n,
          item2Plates: n,
          wadaPlates: n,
          peopleCount: n,
        };
      } else {
        body = {
          unitId: user.unitId,
          date: ymd(targetDate),
          session: sessionForApi,
          isEmergency: meal === "EMERGENCY",
          peopleCount: n,
        };
      }
      await api.placeOrder(body);
      setStep("done");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // ---- step renderers
  return (
    <View style={s.screen}>
      <Header
        title="New Booking"
        actionLabel={step === "done" ? undefined : "Cancel"}
        onAction={step === "done" ? undefined : onCancel}
      />
      <ScrollView contentContainerStyle={s.pad}>
      {step !== "done" && <StepDots step={step} usesMenu={usesMenu} />}

      {/* STEP: choose meal */}
      {step === "meal" && (
        <>
          <Text style={s.h2}>What would you like to book?</Text>
          {MEALS.map((m) => (
            <Pressable key={m.key} style={s.option} onPress={() => pickMeal(m.key)}>
              <Text style={s.optionTitle}>{m.title}</Text>
              <Text style={s.optionSub}>{m.sub}</Text>
            </Pressable>
          ))}
        </>
      )}

      {/* STEP: emergency meal pick */}
      {step === "emgMeal" && (
        <>
          <Text style={s.h2}>Emergency — for which meal?</Text>
          {(["BREAKFAST", "LUNCH", "DINNER"] as const).map((es) => (
            <Pressable
              key={es}
              style={[s.option, emgSession === es && s.optionActive]}
              onPress={() => setEmgSession(es)}
            >
              <Text style={s.optionTitle}>
                {es === "BREAKFAST" ? "Morning Tiffin" : es === "LUNCH" ? "Lunch" : "Dinner"}
              </Text>
            </Pressable>
          ))}
          <NavButtons onBack={() => setStep("meal")} onNext={() => setStep("count")} />
        </>
      )}

      {/* STEP: menu */}
      {step === "menu" && (
        <>
          <Text style={s.h2}>{meal === "TIFFIN" ? "Tiffin" : "Dinner"} menu · {prettyDate(targetDate)}</Text>
          {!menu && !error ? <ActivityIndicator color={colors.primary} /> : null}
          {menu && !menu.template && (
            <Text style={s.error}>No menu set for {dayEnum(tomorrow())}.</Text>
          )}
          {menu?.template && (
            <>
              <View style={[s.card, { backgroundColor: colors.locked }]}>
                <Text style={s.label}>INCLUDED · ITEM 1</Text>
                <Text style={{ color: colors.text }}>
                  {menu.template.item1Dishes.map((d) => d.name).join(", ")}
                </Text>
              </View>

              <Text style={s.label}>CHOOSE ITEM 2</Text>
              {menu.item2Options.map((o: Item2Option) => (
                <Pressable
                  key={o.id}
                  style={[s.option, item2Id === o.id && s.optionActive]}
                  onPress={() => setItem2Id(o.id)}
                >
                  <Text style={s.optionTitle}>{o.label}</Text>
                  <Text style={s.optionSub}>{o.dishes.map((d) => d.name).join(", ")}</Text>
                </Pressable>
              ))}

              <View style={[s.card, { backgroundColor: colors.locked }]}>
                <Text style={s.label}>INCLUDED · ITEM 3</Text>
                <Text style={{ color: colors.text }}>
                  {menu.template.item3Dishes.map((d) => d.name).join(", ")}
                </Text>
              </View>

              <NavButtons
                onBack={() => setStep("meal")}
                onNext={() => setStep("count")}
                nextDisabled={!item2Id}
              />
            </>
          )}
        </>
      )}

      {/* STEP: count */}
      {step === "count" && (
        <>
          <Text style={s.h2}>How many people?</Text>
          <Text style={s.muted}>Each person gets the full plate for this meal.</Text>
          <View style={{ marginTop: 12 }}>
            <Text style={s.label}>NUMBER OF PEOPLE</Text>
            <TextInput
              style={s.input}
              value={count}
              onChangeText={(t) => setCount(t.replace(/[^0-9]/g, ""))}
              keyboardType="number-pad"
              placeholder="0"
              autoFocus
            />
          </View>
          <NavButtons
            onBack={() => setStep(usesMenu ? "menu" : meal === "EMERGENCY" ? "emgMeal" : "meal")}
            onNext={() => setStep("review")}
            nextDisabled={!count || Number(count) <= 0}
          />
        </>
      )}

      {/* STEP: review */}
      {step === "review" && (
        <>
          <Text style={s.h2}>Review & confirm</Text>
          <View style={s.card}>
            <Row label="Meal" value={mealTitle(meal, emgSession)} />
            <Row label="For" value={prettyDate(targetDate)} />
            {usesMenu && (
              <Row
                label="Item 2"
                value={menu?.item2Options.find((o) => o.id === item2Id)?.label ?? "—"}
              />
            )}
            <Row label="People" value={count} />
            {meal === "EMERGENCY" && <Row label="Note" value="Needs admin approval" />}
          </View>
          {error ? <Text style={s.error}>{error}</Text> : null}
          <Pressable style={[s.btn, busy && s.btnDisabled]} disabled={busy} onPress={submit}>
            <Text style={s.btnText}>{busy ? "Booking…" : "Confirm booking"}</Text>
          </Pressable>
          <Pressable style={s.btnGhost} onPress={() => setStep("count")} disabled={busy}>
            <Text style={s.btnGhostText}>Back</Text>
          </Pressable>
        </>
      )}

      {/* STEP: done */}
      {step === "done" && (
        <View style={{ alignItems: "center", marginTop: 40 }}>
          <Text style={{ fontSize: 48 }}>✅</Text>
          <Text style={[s.h1, { marginTop: 12 }]}>Booking confirmed</Text>
          <Text style={[s.muted, { textAlign: "center", marginTop: 4 }]}>
            {mealTitle(meal, emgSession)} for {count} people · {prettyDate(targetDate)}
          </Text>
          <Pressable style={[s.btn, { marginTop: 24, alignSelf: "stretch" }]} onPress={onDone}>
            <Text style={s.btnText}>Done</Text>
          </Pressable>
        </View>
      )}
      </ScrollView>
    </View>
  );
}

function mealTitle(meal: Meal | null, emg: string) {
  if (meal === "EMERGENCY")
    return `Emergency · ${emg === "BREAKFAST" ? "Tiffin" : emg === "LUNCH" ? "Lunch" : "Dinner"}`;
  if (meal === "TIFFIN") return "Morning Tiffin";
  if (meal === "DINNER") return "Dinner";
  if (meal === "LUNCH") return "Lunch";
  return "";
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={[s.rowBetween, { marginBottom: 8 }]}>
      <Text style={s.muted}>{label}</Text>
      <Text style={{ color: colors.text, fontWeight: "700" }}>{value}</Text>
    </View>
  );
}

function NavButtons({
  onBack,
  onNext,
  nextDisabled,
}: {
  onBack: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
      <Pressable style={[s.btnGhost, { flex: 1 }]} onPress={onBack}>
        <Text style={s.btnGhostText}>Back</Text>
      </Pressable>
      <Pressable style={[s.btn, { flex: 2, marginTop: 8 }, nextDisabled && s.btnDisabled]} disabled={nextDisabled} onPress={onNext}>
        <Text style={s.btnText}>Next</Text>
      </Pressable>
    </View>
  );
}

function StepDots({ step, usesMenu }: { step: Step; usesMenu: boolean }) {
  const order: Step[] = usesMenu ? ["meal", "menu", "count", "review"] : ["meal", "count", "review"];
  const current = step === "emgMeal" ? "meal" : step;
  const idx = order.indexOf(current as Step);
  return (
    <View style={{ flexDirection: "row", gap: 6, marginTop: 12, marginBottom: 4 }}>
      {order.map((_, i) => (
        <View
          key={i}
          style={{
            height: 6,
            flex: 1,
            borderRadius: 3,
            backgroundColor: i <= idx ? colors.primary : colors.border,
          }}
        />
      ))}
    </View>
  );
}
