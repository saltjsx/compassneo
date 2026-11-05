import { useAction, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { api } from "@compassneo/backend/api";

/**
 * The calendar feed (convex/calendar.ts): the timetable, assemblies, room changes and work due, as a link a calendar
 * app subscribes to. undefined while loading, null for a signed-out device, else the link (null while it is off).
 */
export function useCalendarLink(token: string | null) {
  return useQuery(api.calendar.link, token ? { token } : "skip");
}

export function useCalendarControls() {
  return { enable: useAction(api.calendar.enable), disable: useMutation(api.calendar.disable) };
}

/** The same link for a calendar app to open: webcal:// asks the device's calendar to subscribe rather than download. */
export const webcalOf = (url: string) => url.replace(/^https?:/, "webcal:");
