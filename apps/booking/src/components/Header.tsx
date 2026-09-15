import { View, Text, Pressable } from "react-native";
import { s } from "../theme";

export default function Header({
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={s.header}>
      <View style={s.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.brand}>{title}</Text>
          {subtitle ? <Text style={s.brandSub}>{subtitle}</Text> : null}
        </View>
        {actionLabel && onAction ? (
          <Pressable onPress={onAction} hitSlop={10}>
            <Text style={s.headerAction}>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
