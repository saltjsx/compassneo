/**
 * How a student adds Canvas, said once: the settings page shows these steps (apps/web features/settings/canvas-link.tsx)
 * and Median's agent reads them out (packages/backend convex/lib/median.ts canvasSetup), so the two never drift apart.
 * No imports: the web app takes this file alone (@compassneo/canvas/help), never the client.
 */

/** Canvas's own page for a student's settings, where access tokens are made. */
export const canvasSettingsUrl = (origin: string) => `${origin.replace(/\/+$/, "")}/profile/settings`;

/**
 * The same page from whatever a student has typed for their Canvas address ("school.instructure.com",
 * "https://canvas.school.edu.au/courses/12"), or null until it reads as one. Only a link for them to open: the server
 * checks the address properly when Canvas is added (canvasOrigin).
 */
export function settingsPageFor(typed: string): string | null {
  const raw = typed.trim();
  if (!raw) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname) ? canvasSettingsUrl(`https://${u.hostname.toLowerCase()}`) : null;
  } catch {
    return null;
  }
}

/** Making the token, in Canvas: the settings page lists these as they are, and the agent walks a student through them. */
export const CANVAS_STEPS = [
  "Open your Canvas settings (Account, then Settings).",
  "Under Approved Integrations, choose New Access Token.",
  "For Purpose, write Compass Neo. Leave the expiry date empty and choose Generate Token.",
  "Copy the token straight away: Canvas shows it only once.",
] as const;

/** Where it goes once made. */
export const CANVAS_PASTE = "Paste it, with your Canvas address, into Compass Neo's Settings, under Canvas, and choose Add Canvas.";

/** What usually goes wrong, and what to do about it. */
export const CANVAS_TROUBLE = [
  {
    problem: "There is no New Access Token button.",
    fix: "The school has turned access tokens off for students, so Compass Neo cannot read its Canvas. Nothing on the student's side changes that; the school's IT team can.",
  },
  {
    problem: "Canvas did not accept that token.",
    fix: "It was usually copied short. Make a new token, use the copy button beside it, and paste it whole.",
  },
  {
    problem: "The address did not answer as Canvas does.",
    fix: "Use the address in the browser bar while on Canvas, such as school.instructure.com or canvas.school.edu.au; the page after it does not matter.",
  },
  {
    problem: "Canvas no longer accepts the token (it worked before).",
    fix: "The token was deleted or expired in Canvas. Make a new one and choose Add a new token under Canvas in Settings.",
  },
] as const;
