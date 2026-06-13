import { describe, expect, it, vi } from "vitest";
import { ApiError, gatewayClient, indexerClient } from "../src/index.js";

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("api client", () => {
  it("returns typed bodies on success", async () => {
    const f = fakeFetch(200, { nonce: "n", expires_at_unix: 1 });
    const gw = gatewayClient("http://gw", f);
    const out = await gw.nonce("0x" + "11".repeat(20));
    expect(out.nonce).toBe("n");
    expect(f).toHaveBeenCalledWith(
      "http://gw/v1/nonce",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws ApiError with status and body on failure", async () => {
    const idx = indexerClient("http://idx", fakeFetch(404, { error: "unknown triangle" }));
    await expect(idx.triangle("0xdead")).rejects.toThrowError(ApiError);
    await expect(idx.triangle("0xdead")).rejects.toMatchObject({
      status: 404,
      body: { error: "unknown triangle" },
    });
  });
});
