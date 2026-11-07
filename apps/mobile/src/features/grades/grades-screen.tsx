import { useMemo } from "react";
import { View } from "react-native";
import { router, Stack } from "expo-router";
import { useTheme } from "@/theme/theme";
import { space } from "@/theme/tokens";
import { useSession } from "@/lib/session";
import { useChecked, useSyncRefresh } from "@/lib/sync";
import { dayIn, zoneOf } from "@/lib/days";
import { ago, useNow } from "@/lib/time";
import { Screen, Section } from "@/components/ui/screen";
import { Card, Rule } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/glass";
import { Empty, Skeleton } from "@/components/ui/notice";
import { Text } from "@/components/ui/text";
import { SyncGauge } from "@/features/sync/sync-gauge";
import { RecentMarks } from "./recent-marks";
import { SubjectRow } from "./subject-row";
import { TrendMark } from "./trend";
import { Upcoming } from "./upcoming";
import { GRADE_STEPS, moved, sourceName, tabular, useGrades, type OverviewGrades, type OverviewSubject, type ReadyGrades } from "./data";

/**
 * Grades, a page pushed from home's grades row, as the web's Grades page has it (apps/web/app/features/student/grades.tsx):
 * the subjects lead, straight under the native header (its title is the layout's; the sync gauge sits at its end), each
 * a dense row in its class's colour; then the marks as they came in, what is still to be marked, and last semester's
 * subjects. A subject opens its class on its grades, where everything about it is. Grades have no fetch of their own
 * (the sync brings them), so pulling down runs a sync and spins until the grades step has come back.
 */
export function GradesScreen() {
  const { me, token } = useSession();
  const now = useNow(60_000);
  const zone = zoneOf(me?.slug ?? "");
  const today = dayIn(zone, now);
  const data = useGrades(token, today);
  const ready = data?.status === "ready" ? data : null;
  const { refresh, refreshing } = useSyncRefresh(token, ready?.fetchedAt, GRADE_STEPS);
  const checked = useChecked(token, ready?.fetchedAt, GRADE_STEPS);
  const again = () => void refresh();
  // Kept the same object between renders: the header is set again whenever its options change. Bare: on iOS 26 the
  // header draws its own glass platter behind it.
  const header = useMemo(() => ({ headerRight: token ? () => <SyncGauge token={token} glass={false} /> : undefined }), [token]);

  const open = (code: string) => router.push({ pathname: "/class/[code]", params: { code, tab: "grades" } });

  return (
    <>
      <Stack.Screen options={header} />
      <Screen refreshing={refreshing} onRefresh={again}>
        <Body data={data} zone={zone} today={today} now={now} onOpen={open} onRefresh={again} refreshing={refreshing} />
        {ready && (
          <Text variant="caption" tone="3" style={{ textAlign: "center" }}>
            From {sourceName(ready.source)}
            {checked ? `, updated ${ago(checked, now)}` : ""}
          </Text>
        )}
      </Screen>
    </>
  );
}

function Body({
  data,
  zone,
  today,
  now,
  onOpen,
  onRefresh,
  refreshing,
}: {
  data: OverviewGrades | null | undefined;
  zone: string;
  today: string;
  now: number;
  onOpen: (code: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const c = useTheme();
  if (data == null) return <GradesSkeleton />;
  switch (data.status) {
    case "none":
      // No Connect (not a WA public school) and no Canvas added: Canvas is added in Settings, its form open.
      return (
        <View style={{ alignItems: "center" }}>
          <Empty title="No grades at this school" icon={<Icon ios="graduationcap.fill" android="school" size={30} color={c.text3} />}>
            Grades come from Connect, which only WA public schools have. If your school uses Canvas, add it and its
            grades show up here.
          </Empty>
          <Button variant="secondary" onPress={() => router.push({ pathname: "/settings", params: { add: "canvas" } })}>
            Add Canvas
          </Button>
        </View>
      );
    case "unavailable":
      return (
        <Card>
          <View accessibilityRole="alert" style={{ gap: space[2] }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
              <Icon ios="exclamationmark.triangle.fill" android="warning" size={16} color={c.warnText} />
              <Text variant="label" tone="warn" style={{ fontWeight: "600" }}>
                Grades did not come through
              </Text>
            </View>
            <Text variant="bodySm" tone="2">
              {data.reason}
            </Text>
            <View style={{ alignSelf: "flex-start", marginTop: space[1] }}>
              <Button variant="secondary" size="sm" pending={refreshing} pendingLabel="Trying again" onPress={onRefresh}>
                Try again
              </Button>
            </View>
          </View>
        </Card>
      );
    case "loading":
      return (
        <View style={{ gap: space[3] }}>
          <Text variant="caption" tone="2" style={{ textAlign: "center" }}>
            Getting your grades from {sourceName(data.source)}
          </Text>
          <GradesSkeleton />
        </View>
      );
    case "ready":
      if (!data.subjects.length && !data.other.length)
        return (
          <Empty title="No grades yet" icon={<Icon ios="graduationcap.fill" android="school" size={30} color={c.text3} />}>
            {data.source === "canvas" ? "Canvas has no graded assignments for you yet." : "Connect has no assessment outlines for you yet."}
          </Empty>
        );
      return <Ready data={data} zone={zone} today={today} now={now} onOpen={onOpen} />;
  }
}

function Ready({ data, zone, today, now, onOpen }: { data: ReadyGrades; zone: string; today: string; now: number; onOpen: (code: string) => void }) {
  const a = data.aggregate;
  return (
    <>
      {data.error && <Problem text={data.error} />}
      {data.subjects.length > 0 && (
        <Section
          title={`Subjects · Semester ${data.semester}`}
          right={
            // How much of the semester is marked and how it moved: the web's line above the list, at the heading's end.
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
              <Text variant="caption" tone="3" style={tabular}>
                {a.marked} of {a.total} marked
              </Text>
              {moved(a.trend) && <TrendMark trend={a.trend} now={now} />}
            </View>
          }
        >
          <Subjects list={data.subjects} now={now} onOpen={onOpen} />
        </Section>
      )}
      <Section title="Recent marks">
        <RecentMarks marks={data.recent} since={data.historySince} zone={zone} today={today} onOpen={onOpen} />
      </Section>
      {data.upcoming.length > 0 && (
        <Section title="Still to be marked">
          <Upcoming items={data.upcoming} zone={zone} today={today} onOpen={onOpen} />
        </Section>
      )}
      {data.other.length > 0 && (
        <Section title={`Semester ${data.other[0]!.semester}`}>
          <Subjects list={data.other} now={now} onOpen={onOpen} />
        </Section>
      )}
    </>
  );
}

function Subjects({ list, now, onOpen }: { list: OverviewSubject[]; now: number; onOpen: (code: string) => void }) {
  return (
    <Card padded={false}>
      {list.map((s, i) => (
        <View key={s.key}>
          {i > 0 && <Rule />}
          <SubjectRow s={s} now={now} onOpen={onOpen} index={i} />
        </View>
      ))}
    </Card>
  );
}

/** The last fetch of grades had a problem: the grades shown are the last that came through whole. */
function Problem({ text }: { text: string }) {
  const c = useTheme();
  return (
    <View accessibilityRole="alert" style={{ flexDirection: "row", alignItems: "flex-start", gap: space[2], paddingHorizontal: space[1] }}>
      <View style={{ marginTop: 2 }}>
        <Icon ios="exclamationmark.triangle.fill" android="warning" size={14} color={c.warnText} />
      </View>
      <Text variant="caption" tone="2" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

/** The subjects on their way: a heading and dense rows the height they will have. */
function GradesSkeleton() {
  return (
    <View accessible accessibilityLabel="Loading grades" style={{ gap: space[2] }}>
      <View style={{ paddingHorizontal: space[1], minHeight: 24, justifyContent: "center" }}>
        <Skeleton height={12} width={140} />
      </View>
      <Card padded={false}>
        {[0, 1, 2, 3, 4, 5].map(i => (
          <View key={i}>
            {i > 0 && <Rule />}
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: 14, paddingVertical: space[2], minHeight: 52 }}>
              <Skeleton height={16} width={16} round={8} />
              <View style={{ flex: 1, gap: space[1.5] }}>
                <Skeleton height={14} width="45%" />
                <Skeleton height={11} width="65%" />
              </View>
              <Skeleton height={14} width={44} />
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}
