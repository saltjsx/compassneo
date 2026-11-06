import { expect, test } from "bun:test";
import { CANVAS_PASTE, CANVAS_STEPS, CANVAS_TROUBLE, canvasSettingsUrl, settingsPageFor } from "./help";

test("the settings page from whatever was typed for the address", () => {
  expect(settingsPageFor("school.instructure.com")).toBe("https://school.instructure.com/profile/settings");
  expect(settingsPageFor(" https://Canvas.Example.edu.au/courses/12 ")).toBe("https://canvas.example.edu.au/profile/settings");
  expect(settingsPageFor("")).toBeNull();
  expect(settingsPageFor("not an address")).toBeNull();
  expect(canvasSettingsUrl("https://school.instructure.com/")).toBe("https://school.instructure.com/profile/settings");
});

test("the steps end where the token goes, and every usual problem has a fix", () => {
  expect(CANVAS_STEPS.at(-1)).toMatch(/copy/i);
  expect(CANVAS_PASTE).toMatch(/paste/i);
  expect(CANVAS_TROUBLE.every(t => t.problem && t.fix)).toBe(true);
});
