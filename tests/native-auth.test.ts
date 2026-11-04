import test from "node:test";
import assert from "node:assert/strict";
import { nativeCallbackParams } from "../apps/mobile/lib/auth-callback";
test("native PKCE callback accepts only the app callback and validates flow identifiers", () => {
  assert.deepEqual(
    nativeCallbackParams(
      "overcall://auth/callback?code=one-time-test-code&sb_flow_id=fixture-flow-123",
    ),
    {
      code: "one-time-test-code",
      flowId: "fixture-flow-123",
      error: undefined,
    },
  );
  assert.equal(
    nativeCallbackParams("https://unrelated.example/callback?code=x"),
    null,
  );
  assert.equal(nativeCallbackParams("overcall://other/callback?code=x"), null);
  assert.equal(
    nativeCallbackParams("overcall://auth/callback?code=x&sb_flow_id=../../bad")
      ?.flowId,
    undefined,
  );
});
