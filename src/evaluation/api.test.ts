import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpEvaluationApi } from "./api.js";

const settings = {
  apiKey: "key",
  tenantId: "org_1",
  orgId: "org_1",
  appId: undefined,
  baseUrl: "https://api.example.test",
  environment: "staging",
  iotEndpoint: undefined,
  wsUrl: undefined,
  timeout: 1_000,
  maxRetries: 0,
  failOpen: false,
  contentCaptureMode: "metadata_only" as const,
  redactKeys: [],
  maxContentLength: 4_096,
};

afterEach(() => vi.unstubAllGlobals());

describe("HttpEvaluationApi", () => {
  it("fetches a precise dataset revision with scoped credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "item_1", input: { q: "hello" } }] }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const api = new HttpEvaluationApi(settings);

    await expect(api.fetchDatasetRevisionItems("dataset/id", 3)).resolves.toEqual([
      {
        id: "item_1",
        input: { q: "hello" },
        expectedOutput: undefined,
        metadata: undefined,
        attachments: undefined,
        toolTrajectory: undefined,
      },
    ]);
    const request = fetchMock.mock.calls[0]?.[0] as URL;
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.toString()).toBe(
      "https://api.example.test/v2/datasets/dataset%2Fid/revisions/3/items?environment=staging",
    );
    expect(init.headers).toMatchObject({
      "x-api-key": "key",
      authorization: "Bearer key",
      "x-tenant-id": "org_1",
    });
  });

  it("submits each result and returns a stable gate response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 201 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { passed: false, experimentId: "exp_1", reasons: ["quality regression"] },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const api = new HttpEvaluationApi(settings);
    await api.submitResults("exp_1", [
      { itemId: "item_1", output: "answer", latencyMs: 12, status: "passed" },
    ]);
    await expect(api.gateExperiment("exp_1", { minimumScore: 0.9 })).resolves.toEqual({
      passed: false,
      experimentId: "exp_1",
      reasons: ["quality regression"],
    });
    const submission = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(submission.results[0]).toMatchObject({
      itemId: "item_1",
      output: "answer",
      latencyMs: 12,
    });
  });

  it("starts a local experiment and reads its asynchronous status", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 202 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: "exp_1", status: "running" } }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const api = new HttpEvaluationApi(settings);
    await api.startExperiment("exp_1");
    await expect(api.getExperimentStatus("exp_1")).resolves.toBe("running");
    expect((fetchMock.mock.calls[0]?.[0] as URL).pathname).toBe("/v2/experiments/exp_1/run");
  });
});
