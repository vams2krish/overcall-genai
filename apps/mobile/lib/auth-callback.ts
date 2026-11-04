export const nativeRedirectUrl = "overcall://auth/callback";
export function nativeCallbackParams(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (
    url.protocol !== "overcall:" ||
    url.hostname !== "auth" ||
    url.pathname !== "/callback"
  )
    return null;
  const code = url.searchParams.get("code");
  const flow = url.searchParams.get("sb_flow_id");
  return {
    code: code && code.length <= 8192 ? code : null,
    flowId: flow && /^[a-zA-Z0-9_-]{8,64}$/.test(flow) ? flow : undefined,
    error: url.searchParams.get("error_description")?.slice(0, 500),
  };
}
