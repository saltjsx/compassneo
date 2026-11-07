import Constants from "expo-constants";
import { useLocalSearchParams } from "expo-router";
import { themePref, type ThemePref } from "@/theme/theme";
import { space } from "@/theme/tokens";
import { useSession } from "@/lib/session";
import { useStored } from "@/lib/store";
import { Screen } from "@/components/ui/screen";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/glass";
import { Text } from "@/components/ui/text";
import { Quiet } from "@/components/ui/quiet";
import { AiCard } from "./ai-card";
import { CalendarCard } from "./calendar-card";
import { CanvasCard } from "./canvas-card";
import { GuestCard } from "./guest-card";
import { SettingHead } from "./head";
import { NotificationsCard } from "./notifications-card";
import { ProfileCard } from "./profile-card";

const THEMES: { value: ThemePref; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "auto", label: "Auto" },
];

/**
 * Settings, a page of its own, opened from the photo on home (the header says "Settings"): the web's settings page
 * (apps/web/app/routes/settings.tsx) for a phone, one card each. Who is signed in, where and the last sync, with Sync
 * now and Sign out; guest mode, lending the phone to a friend (features/guest); the theme; notifications; Canvas;
 * the calendar feed; AI access; and the app's version at the foot. ?add=canvas (Grades, at a school without Connect)
 * puts Canvas first, its form open. The cards are content, drawn the web's way; everything in them you press is
 * Liquid Glass.
 */
export function SettingsScreen() {
  const { me, token } = useSession();
  const { add } = useLocalSearchParams<{ add?: string }>();
  const asked = add === "canvas";
  const theme = useStored(themePref);
  // Signing out clears the session a frame before the guard swaps this page for sign-in.
  if (!me || !token) return <Screen>{null}</Screen>;
  const canvas = <CanvasCard token={token} asked={asked} />;

  return (
    <Screen contentStyle={{ gap: space[3] }}>
      {asked && canvas}
      <ProfileCard me={me} token={token} />
      <GuestCard />

      <Card panelStyle={{ gap: space[3] }}>
        <SettingHead ios="moon.fill" android="dark_mode" title="Appearance" caption="Light, dark, or whichever your phone is using." />
        <Segmented label="Theme" options={THEMES} value={theme} onChange={v => themePref.set(v)} />
      </Card>

      {/* Quiet: until convex/push.ts is on the deployment, its query throws; settings still draws without the card. */}
      <Quiet name="Notifications">
        <NotificationsCard token={token} />
      </Quiet>
      {!asked && canvas}
      <CalendarCard token={token} />
      <AiCard token={token} />

      <Text variant="caption" tone="3" style={{ textAlign: "center", marginTop: space[2] }}>
        Compass Neo {Constants.expoConfig?.version ?? ""}
      </Text>
    </Screen>
  );
}
