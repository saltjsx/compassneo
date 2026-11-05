import { afterEach, describe, expect, test } from "bun:test";
import { CanvasError, CanvasSession, canvasOrigin, cleanToken, looksLikeToken, plainText, publicHost } from "./canvas";

const ORIGIN = "https://canvas.example.edu.au";
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answers fetches from a table of URL → response, recording what was asked. */
function fake(routes: Record<string, () => Response>) {
  const asked: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    asked.push({ url, init });
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch: ${url}`);
    return route();
  }) as typeof fetch;
  return asked;
}
const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });

describe("addresses", () => {
  test("whatever is pasted becomes an https origin", () => {
    expect(canvasOrigin("school.instructure.com")).toBe("https://school.instructure.com");
    expect(canvasOrigin("canvas.example.edu.au/courses/12")).toBe(ORIGIN);
    expect(canvasOrigin("http://Canvas.Example.edu.au/")).toBe(ORIGIN);
  });

  test("private and odd addresses are refused", () => {
    for (const bad of ["", "not a url", "localhost", "10.0.0.1", "[::1]", "metadata.google.internal", "printer.local", "evil.com:8080", "user:pass@canvas.example.edu.au"]) {
      expect(canvasOrigin(bad)).toBeNull();
    }
    expect(publicHost("files.instructure.com")).toBe(true);
    expect(publicHost("cache.lan")).toBe(false);
  });

  test("tokens are cleaned of spaces and a Bearer prefix", () => {
    expect(cleanToken("  Bearer 1234~abcdefghijklmnopqrstuvwxyz \n")).toBe("1234~abcdefghijklmnopqrstuvwxyz");
    expect(looksLikeToken("1234~abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(looksLikeToken("hello")).toBe(false);
  });
});

test("plainText keeps the words and drops the markup", () => {
  expect(plainText("<p>Bring &amp; read</p><script>x()</script><ul><li>one</li></ul>")).toBe("Bring & read\n\none");
  expect(plainText("")).toBeNull();
});

describe("the session", () => {
  test("lists follow the Link header, and send the token", async () => {
    const page2 = `${ORIGIN}/api/v1/courses?page=2`;
    const asked = fake({
      [`${ORIGIN}/api/v1/courses?per_page=100`]: () => json([{ id: "1" }], { link: `<${page2}>; rel="next"` }),
      [page2]: () => json([{ id: "2" }]),
    });
    const s = new CanvasSession(ORIGIN, "1~token");
    expect(await s.list("/api/v1/courses")).toEqual([{ id: "1" }, { id: "2" }]);
    expect((asked[0]!.init!.headers as Record<string, string>).Authorization).toBe("Bearer 1~token");
  });

  test("a page from another host is refused before it is fetched", async () => {
    fake({ [`${ORIGIN}/api/v1/courses?per_page=100`]: () => json([], { link: `<https://elsewhere.example.com/api/v1/courses?page=2>; rel="next"` }) });
    await expect(new CanvasSession(ORIGIN, "t").list("/api/v1/courses")).rejects.toMatchObject({ code: "upstream" });
  });

  test("paths off the read-only list are refused", async () => {
    fake({});
    await expect(new CanvasSession(ORIGIN, "t").get("/api/v1/courses/1/assignments/2/submissions")).rejects.toMatchObject({ code: "read-only" });
  });

  test("a 401 is a refused token", async () => {
    fake({ [`${ORIGIN}/api/v1/users/self`]: () => new Response("{}", { status: 401, headers: { "content-type": "application/json" } }) });
    const e = await new CanvasSession(ORIGIN, "t").whoami().catch(e => e);
    expect(e).toBeInstanceOf(CanvasError);
    expect(e.code).toBe("bad-token");
  });

  test("ids stay strings past 2^53", async () => {
    fake({ [`${ORIGIN}/api/v1/users/self`]: () => json({ id: "720000000000000123", short_name: "Sam" }) });
    expect(await new CanvasSession(ORIGIN, "t").whoami()).toEqual({ id: "720000000000000123", name: "Sam" });
  });
});

describe("files", () => {
  const meta = (url: string) => () => json({ url, "content-type": "application/pdf", display_name: "Notes.pdf", size: 3 });

  test("the download link is fetched without the token, through the file store's redirect", async () => {
    const asked = fake({
      [`${ORIGIN}/api/v1/files/7`]: meta(`${ORIGIN}/files/7/download?verifier=v`),
      [`${ORIGIN}/files/7/download?verifier=v`]: () => new Response(null, { status: 302, headers: { location: "https://files.example-cdn.com/7?sig=s" } }),
      "https://files.example-cdn.com/7?sig=s": () => new Response("pdf", { status: 200 }),
    });
    const f = await new CanvasSession(ORIGIN, "1~token").file("7");
    expect(new TextDecoder().decode(f!.bytes)).toBe("pdf");
    expect(f!.name).toBe("Notes.pdf");
    for (const a of asked.slice(1)) expect(JSON.stringify(a.init?.headers ?? {})).not.toContain("Bearer");
  });

  test("a redirect to a private address is not followed", async () => {
    fake({
      [`${ORIGIN}/api/v1/files/7`]: meta(`${ORIGIN}/files/7/download`),
      [`${ORIGIN}/files/7/download`]: () => new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest/meta-data" } }),
    });
    await expect(new CanvasSession(ORIGIN, "t").file("7")).rejects.toMatchObject({ code: "upstream" });
  });

  test("a file over the limit is not fetched", async () => {
    const asked = fake({ [`${ORIGIN}/api/v1/files/7`]: meta(`${ORIGIN}/files/7/download`) });
    const f = await new CanvasSession(ORIGIN, "t").file("7", 2);
    expect(f!.bytes.byteLength).toBe(0);
    expect(f!.size).toBe(3);
    expect(asked).toHaveLength(1);
  });
});
