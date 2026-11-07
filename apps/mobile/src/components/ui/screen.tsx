import type { ReactNode } from "react";
import { RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme/theme";
import { space } from "@/theme/tokens";
import { liquidGlass } from "./glass";
import { Text } from "./text";

/**
 * Whether every page's navigation bar is see-through: exactly where the bar is Liquid Glass (iOS 26). The root layout
 * makes its bars so from this, and a Screen then runs up under its bar. Elsewhere (Android, iOS before 26) the bar is
 * solid on the page colour and the page starts under it.
 */
export const seeThroughBar = liquidGlass;

/**
 * A scrolling screen on the flat page colour, as on the web: no glow, no big title. Every page (home too) sits under a
 * native navigation bar from the root layout's Stack, which carries its title and buttons.
 *
 * Under a see-through bar the scroll fills the whole screen and iOS insets it (`contentInsetAdjustmentBehavior`
 * "automatic"): the content starts just under the bar and the home indicator, scrolls up under the bar, and fades out
 * softly beneath it (iOS 26's scroll edge effect, which react-native-screens hands to this scroll because it is the
 * first view of the page). Under a solid bar the page already starts below it, so nothing is adjusted ("never") and only
 * the bottom inset is added here: the space above a page is never the safe area twice.
 *
 * `scroll={false}` keeps it the same scroll, held still, so the insets are the same either way.
 */
export function Screen({
  children,
  refreshing,
  onRefresh,
  scroll = true,
  contentStyle,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  const inset = useSafeAreaInsets();
  const padding: ViewStyle = {
    paddingTop: space[3],
    paddingHorizontal: space[4],
    paddingBottom: (seeThroughBar ? 0 : inset.bottom) + space[8],
    gap: space[4],
  };
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.page }}
      contentContainerStyle={[padding, !scroll && { flexGrow: 1 }, contentStyle]}
      contentInsetAdjustmentBehavior={seeThroughBar ? "automatic" : "never"}
      scrollEnabled={scroll}
      keyboardShouldPersistTaps="handled"
      // A field low on the page (Canvas's token) scrolls up above the keyboard on iOS; Android resizes the window.
      automaticallyAdjustKeyboardInsets
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.text2} colors={[c.neo]} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

/** A section's small heading, with an optional action at its end. */
export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: space[2] }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space[1], minHeight: 24 }}>
        <Text variant="overline" tone="2" style={{ flex: 1 }} accessibilityRole="header">
          {title}
        </Text>
        {right}
      </View>
      {children}
    </View>
  );
}
