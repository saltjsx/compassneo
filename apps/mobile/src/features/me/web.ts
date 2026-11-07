import * as WebBrowser from "expo-web-browser";
import type { Palette } from "@/theme/tokens";

/**
 * Opens a page in the in-app browser (Safari's sheet on iOS, a custom tab on Android), in the theme's colours, so it
 * reads as a page of this app rather than a jump to another: a student's own Canvas settings, while adding Canvas.
 */
export function openPage(url: string, c: Palette) {
  void WebBrowser.openBrowserAsync(url, {
    controlsColor: c.neoText,
    toolbarColor: c.page,
    dismissButtonStyle: "done",
  }).catch(() => {});
}
