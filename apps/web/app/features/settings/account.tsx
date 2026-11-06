import { useMutation } from "convex/react";
import { api } from "@compassneo/backend/api";
import { Button } from "@/components/glaze/ui/button";
import { Icon, School, SignOut, Sync } from "@/components/glaze/icon";
import { hostOf } from "@/lib/neo/schools";
import { signOutNotice, type Me } from "@/lib/neo/session";
import { useSyncState } from "@/lib/neo/sync";
import { useNow } from "@/lib/neo/time";
import { syncLabel } from "@/features/sync/sync-button";
import { Face } from "@/features/home/profile";

/** Who is signed in, where, and the last sync, with a sync now and the way out. Leads the settings page. */
export function Account({ me, token, onSignOut }: { me: Me; token: string; onSignOut: () => void }) {
  const synced = useSyncState(token);
  const now = useNow();
  const syncNow = useMutation(api.sync.now);

  const sync = () => {
    void syncNow({ token, force: true })
      .then(r => {
        if (!r.ok && (r.code === "signed-out" || r.code === "password-changed")) signOutNotice.set(r.message);
      })
      .catch(() => {});
  };

  return (
    <section aria-labelledby="account-title" className="neo-stack neo-notice flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <Face me={me} className="size-11" textClassName="type-label" />
        <div className="min-w-0 flex-1">
          <h2 id="account-title" className="truncate type-label-lg text-text-1">
            {me.fullName ?? me.displayName}
          </h2>
          <p className="type-caption text-text-2">{me.formGroup ? `Form ${me.formGroup}` : me.username}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t border-line-faint pt-3">
        <div className="flex items-start gap-2.5">
          <Icon icon={School} className="mt-0.5 text-text-2" />
          <div className="min-w-0">
            <p className="type-label-sm text-text-1">{me.schoolName}</p>
            <p className="truncate type-caption text-text-2">
              {me.username} · {hostOf(me.slug)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <Icon icon={Sync} className="text-text-2" />
          <p className="min-w-0 flex-1 type-caption text-text-2">{syncLabel(synced, now)}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" className="flex-1" onClick={sync}>
          <Icon icon={Sync} />
          Sync now
        </Button>
        <Button size="sm" variant="secondary" className="flex-1" onClick={onSignOut}>
          <Icon icon={SignOut} />
          Sign out
        </Button>
      </div>
    </section>
  );
}
