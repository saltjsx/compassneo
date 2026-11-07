import { useState } from "react";
import { Alert, Platform, Share, View } from "react-native";
import Animated from "react-native-reanimated";
import { useAction, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { api } from "@compassneo/backend/api";
import { signOutNotice } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/glass";
import { Text } from "@/components/ui/text";
import { focusIn } from "@/theme/motion";
import { useTheme } from "@/theme/theme";
import { space } from "@/theme/tokens";
import { SettingHead } from "./head";

/**
 * AI access (convex/mcp.ts), as the web's settings page has it (apps/web/app/features/settings/ai-access.tsx). Off: a
 * way to turn it on. On: where the link goes (an MCP server's address, for Claude's connectors or any MCP app), a way to
 * share it (the share sheet has Copy), and a way to turn it off, which ends the link, so it asks first (turning it on
 * again makes a new one).
 */
export function AiCard({ token }: { token: string }) {
  const c = useTheme();
  const link = useQuery(api.mcp.link, { token });
  const enable = useAction(api.mcp.enable);
  const disable = useMutation(api.mcp.disable);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!link) return null;
  const url = link.url;

  const turnOn = () => {
    setBusy(true);
    setError(null);
    void enable({ token })
      .then(r => {
        if (r.ok) return;
        if (r.code === "signed-out" || r.code === "password-changed") signOutNotice.set(r.message);
        else setError(r.message);
      })
      .catch(() => setError("That did not work. Try again."))
      .finally(() => setBusy(false));
  };
  const turnOff = () =>
    Alert.alert("Turn off AI access?", "Apps using the link can no longer read anything, and turning it on again makes a new link.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Turn off AI access",
        style: "destructive",
        onPress: () => {
          setBusy(true);
          void disable({ token })
            .catch(() => {})
            .finally(() => setBusy(false));
        },
      },
    ]);
  // iOS shares a URL as a link (the sheet offers Copy); Android shares it as text, which its sheet copies too.
  const share = (u: string) => void Share.share(Platform.OS === "ios" ? { url: u } : { message: u }).catch(() => {});

  return (
    <Card panelStyle={{ gap: space[3] }}>
      <SettingHead
        ios="sparkles"
        android="auto_awesome"
        title="AI access"
        caption={
          url
            ? "In Claude, open Settings, then Connectors, choose Add custom connector and paste this link. Any app that takes an MCP server works."
            : "Let Claude or another AI app read your timetable, classes, work, grades, attendance and notices. It can look, but it cannot hand anything in or change anything."
        }
      >
        {error && (
          <Animated.View key={error} entering={focusIn()}>
            <Text variant="caption" tone="warn" accessibilityLiveRegion="polite" style={{ marginTop: 2 }}>
              {error}
            </Text>
          </Animated.View>
        )}
      </SettingHead>

      {url ? (
        <>
          <Button size="sm" variant="secondary" icon={<Icon ios="square.and.arrow.up" android="share" size={13} color={c.text1} weight="semibold" />} onPress={() => share(url)}>
            Copy or share link
          </Button>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <Text variant="caption" tone="3" style={{ flex: 1 }}>
              Anyone with the link can read your school data.
            </Text>
            <Button size="sm" variant="secondary" pending={busy} pendingLabel="Turning off" onPress={turnOff}>
              Turn off
            </Button>
          </View>
        </>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          pending={busy}
          pendingLabel="Making a link"
          icon={<Icon ios="sparkles" android="auto_awesome" size={13} color={c.text1} weight="semibold" />}
          onPress={turnOn}
        >
          Get an AI link
        </Button>
      )}
    </Card>
  );
}
