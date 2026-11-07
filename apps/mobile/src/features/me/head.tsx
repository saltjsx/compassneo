import type { ReactNode } from "react";
import { View } from "react-native";
import type { AndroidSymbol, SFSymbol } from "expo-symbols";
import { Icon } from "@/components/ui/glass";
import { Text } from "@/components/ui/text";
import { useTheme } from "@/theme/theme";
import { space } from "@/theme/tokens";

/**
 * A settings card's own heading, as each card on the web's settings page opens (apps/web/app/routes/settings.tsx): a
 * quiet glyph (or `mark`, a source's own: Canvas's), the card's name, and a line on what it is for. `children` sits under
 * the line (an error).
 */
export function SettingHead({
  ios,
  android,
  mark,
  title,
  caption,
  children,
}: { title: string; caption: string; children?: ReactNode } & ({ ios: SFSymbol; android: AndroidSymbol; mark?: never } | { mark: ReactNode; ios?: never; android?: never })) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space[3] }}>
      <View style={{ width: 18, alignItems: "center", paddingTop: 1 }}>
        {mark ?? <Icon ios={ios!} android={android} size={16} color={c.text2} />}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" accessibilityRole="header">
          {title}
        </Text>
        <Text variant="caption" tone="2">
          {caption}
        </Text>
        {children}
      </View>
    </View>
  );
}
