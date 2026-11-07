import { useState } from "react";
import { Alert, View } from "react-native";
import Animated from "react-native-reanimated";
import { useAction, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { CANVAS_STEPS, settingsPageFor } from "@compassneo/canvas/help";
import { api } from "@compassneo/backend/api";
import { signOutNotice } from "@/lib/session";
import { CanvasMark } from "@/components/brand/canvas-mark";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Fold } from "@/components/ui/fold";
import { Icon } from "@/components/ui/glass";
import { Text } from "@/components/ui/text";
import { focusIn } from "@/theme/motion";
import { useTheme } from "@/theme/theme";
import { space } from "@/theme/tokens";
import { SettingHead } from "./head";
import { openPage } from "./web";

/**
 * Canvas (convex/canvas.ts), as the web's settings page has it (apps/web/app/features/settings/canvas-link.tsx). Not
 * added: a way to add it, which folds open a short form: the school's Canvas address, the steps to make an access token
 * (packages/canvas help.ts, the same steps the web and the help agent give) with a button straight to the student's own
 * Canvas settings once the address reads as one, and the token. Added: where and as whom, and a way to remove it, which
 * asks first (adding it back takes a new token). Canvas no longer taking the token: says so, with the form for a new one.
 * `asked` (settings?add=canvas, from Grades) opens the form at once.
 */
export function CanvasCard({ token, asked }: { token: string; asked?: boolean }) {
  const c = useTheme();
  const status = useQuery(api.canvas.status, { token });
  const add = useAction(api.canvas.add);
  const remove = useMutation(api.canvas.remove);
  const [open, setOpen] = useState(!!asked);
  const [pending, setPending] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [missing, setMissing] = useState<{ address?: string; accessToken?: string }>({});
  const [error, setError] = useState<string | null>(null);
  if (!status) return null;

  const typed = address ?? (status.added ? status.host : "");
  const settingsPage = settingsPageFor(typed);

  const submit = () => {
    const blank = {
      address: typed.trim() ? undefined : "Enter your school's Canvas address.",
      accessToken: accessToken.trim() ? undefined : "Paste the access token you made in Canvas.",
    };
    setMissing(blank);
    if (blank.address || blank.accessToken) return;
    setPending(true);
    setError(null);
    void add({ token, address: typed, accessToken })
      .then(r => {
        if (r.ok) {
          setOpen(false);
          setAccessToken("");
          return;
        }
        if (r.code === "signed-out" || r.code === "password-changed") signOutNotice.set(r.message);
        else setError(r.message);
      })
      .catch(() => setError("Compass Neo could not reach its server. Try again."))
      .finally(() => setPending(false));
  };
  const cancel = () => {
    setOpen(false);
    setError(null);
    setMissing({});
    setAccessToken("");
  };
  const askRemove = () =>
    Alert.alert("Remove Canvas?", "Its work, files and notices leave Compass Neo, and adding it back takes a new access token.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove Canvas",
        style: "destructive",
        onPress: () => {
          setRemoving(true);
          void remove({ token })
            .catch(() => {})
            .finally(() => setRemoving(false));
        },
      },
    ]);

  const caption = !status.added
    ? "If your school uses Canvas too, add it to see its work beside Compass's."
    : (status.refused ??
      [status.name, status.host, status.courses != null && `${status.courses} ${status.courses === 1 ? "course" : "courses"}`].filter(Boolean).join(" · "));

  return (
    <Card panelStyle={{ gap: space[3] }}>
      <SettingHead mark={<CanvasMark size={15} />} title="Canvas" caption={caption} />

      <Fold open={open}>
        <View style={{ gap: space[4] }}>
          <Field
            label="Canvas address"
            value={typed}
            onChangeText={t => {
              setAddress(t);
              if (missing.address) setMissing(m => ({ ...m, address: undefined }));
            }}
            placeholder="school.instructure.com"
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            keyboardType="url"
            textContentType="URL"
            error={missing.address}
            hint="The address in your browser bar when you're on Canvas."
          />

          <View style={{ gap: space[2] }}>
            <Text variant="label" style={{ fontSize: 14, paddingHorizontal: space[1] }}>
              Make an access token
            </Text>
            <View style={{ gap: space[1], paddingHorizontal: space[1] }}>
              {CANVAS_STEPS.map((step, i) => (
                <View key={step} style={{ flexDirection: "row", gap: space[2] }}>
                  <Text variant="caption" tone="3" style={{ width: 14, fontVariant: ["tabular-nums"] }}>
                    {i + 1}.
                  </Text>
                  <Text variant="caption" tone="2" style={{ flex: 1 }}>
                    {step}
                  </Text>
                </View>
              ))}
            </View>
            <Button
              size="sm"
              variant="secondary"
              disabled={!settingsPage}
              icon={<Icon ios="arrow.up.forward" android="arrow_outward" size={12} color={settingsPage ? c.text1 : c.textDisabled} weight="semibold" />}
              onPress={() => settingsPage && openPage(settingsPage, c)}
              style={{ alignSelf: "flex-start" }}
            >
              Open your Canvas settings
            </Button>
            <Text variant="caption" tone="3" style={{ paddingHorizontal: space[1] }}>
              {"No New Access Token button? Your school has turned tokens off, and Compass Neo can't read its Canvas."}
            </Text>
          </View>

          <Field
            label="Access token"
            value={accessToken}
            onChangeText={t => {
              setAccessToken(t);
              if (missing.accessToken) setMissing(m => ({ ...m, accessToken: undefined }));
            }}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            textContentType="none"
            returnKeyType="done"
            onSubmitEditing={submit}
            error={missing.accessToken}
          />

          {error && (
            <Animated.View key={error} entering={focusIn()}>
              <Text variant="caption" tone="fail" accessibilityLiveRegion="polite" style={{ paddingHorizontal: space[1] }}>
                {error}
              </Text>
            </Animated.View>
          )}

          <View style={{ flexDirection: "row", gap: space[2] }}>
            <Button size="sm" variant="secondary" onPress={cancel} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" onPress={submit} pending={pending} pendingLabel="Checking with Canvas" style={{ flex: 1 }}>
              {status.added ? "Use this token" : "Add Canvas"}
            </Button>
          </View>
        </View>
      </Fold>

      {!open &&
        (!status.added ? (
          <Button size="sm" variant="secondary" icon={<Icon ios="plus" android="add" size={13} color={c.text1} weight="semibold" />} onPress={() => setOpen(true)}>
            Add Canvas
          </Button>
        ) : (
          <>
            {status.refused && (
              <Button size="sm" variant="secondary" onPress={() => setOpen(true)}>
                Add a new token
              </Button>
            )}
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
              <Text variant="caption" tone="3" style={{ flex: 1 }}>
                Read only. Nothing is ever sent to Canvas.
              </Text>
              <Button size="sm" variant="secondary" pending={removing} pendingLabel="Removing" onPress={askRemove}>
                Remove
              </Button>
            </View>
          </>
        ))}
    </Card>
  );
}
