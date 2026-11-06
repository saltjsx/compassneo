/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as ai from "../ai.js";
import type * as announcements from "../announcements.js";
import type * as attendance from "../attendance.js";
import type * as auth from "../auth.js";
import type * as cache from "../cache.js";
import type * as calendar from "../calendar.js";
import type * as canvas from "../canvas.js";
import type * as chronicle from "../chronicle.js";
import type * as classes from "../classes.js";
import type * as classlist from "../classlist.js";
import type * as connect from "../connect.js";
import type * as crons from "../crons.js";
import type * as events from "../events.js";
import type * as http from "../http.js";
import type * as learners from "../learners.js";
import type * as lib_assemblies from "../lib/assemblies.js";
import type * as lib_canvas from "../lib/canvas.js";
import type * as lib_compass from "../lib/compass.js";
import type * as lib_connect from "../lib/connect.js";
import type * as lib_courses from "../lib/courses.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_days from "../lib/days.js";
import type * as lib_grades from "../lib/grades.js";
import type * as lib_history from "../lib/history.js";
import type * as lib_ics from "../lib/ics.js";
import type * as lib_lessons from "../lib/lessons.js";
import type * as lib_links from "../lib/links.js";
import type * as lib_match from "../lib/match.js";
import type * as lib_median from "../lib/median.js";
import type * as lib_plan from "../lib/plan.js";
import type * as lib_same from "../lib/same.js";
import type * as lib_target from "../lib/target.js";
import type * as median from "../median.js";
import type * as overview from "../overview.js";
import type * as plans from "../plans.js";
import type * as pools from "../pools.js";
import type * as resources from "../resources.js";
import type * as schools from "../schools.js";
import type * as sync from "../sync.js";
import type * as teachers from "../teachers.js";
import type * as timetable from "../timetable.js";
import type * as work from "../work.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  ai: typeof ai;
  announcements: typeof announcements;
  attendance: typeof attendance;
  auth: typeof auth;
  cache: typeof cache;
  calendar: typeof calendar;
  canvas: typeof canvas;
  chronicle: typeof chronicle;
  classes: typeof classes;
  classlist: typeof classlist;
  connect: typeof connect;
  crons: typeof crons;
  events: typeof events;
  http: typeof http;
  learners: typeof learners;
  "lib/assemblies": typeof lib_assemblies;
  "lib/canvas": typeof lib_canvas;
  "lib/compass": typeof lib_compass;
  "lib/connect": typeof lib_connect;
  "lib/courses": typeof lib_courses;
  "lib/crypto": typeof lib_crypto;
  "lib/days": typeof lib_days;
  "lib/grades": typeof lib_grades;
  "lib/history": typeof lib_history;
  "lib/ics": typeof lib_ics;
  "lib/lessons": typeof lib_lessons;
  "lib/links": typeof lib_links;
  "lib/match": typeof lib_match;
  "lib/median": typeof lib_median;
  "lib/plan": typeof lib_plan;
  "lib/same": typeof lib_same;
  "lib/target": typeof lib_target;
  median: typeof median;
  overview: typeof overview;
  plans: typeof plans;
  pools: typeof pools;
  resources: typeof resources;
  schools: typeof schools;
  sync: typeof sync;
  teachers: typeof teachers;
  timetable: typeof timetable;
  work: typeof work;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  syncPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"syncPool">;
  backgroundPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"backgroundPool">;
  aiPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"aiPool">;
};
