interface ErrorDetails {
  message: string;
  code: string | null;
  type: string | null;
  requestId: string | null;
  retryAfter: string | null;
}

const quotaMessages: Record<string, string> = {
  insufficient_quota:
    "OpenAI API quota is unavailable for this key. Check the API credit balance and usage limits for its organization/project. Waiting and retrying will not resolve a quota issue.",
  credit_balance_exhausted:
    "The OpenAI organization's prepaid API credit balance is exhausted. Check its API billing settings before reconnecting.",
  organization_spend_limit_exceeded:
    "The OpenAI organization has reached its monthly spend limit. Check the organization's limit settings or wait for the monthly reset.",
  project_spend_limit_exceeded:
    "This OpenAI project has reached its monthly spend limit. Check the project's limit settings or wait for the monthly reset.",
  organization_usage_limit_exceeded:
    "The OpenAI organization has reached its approved monthly usage limit. Check the organization's usage limits with its administrator.",
};

function identifier(value: unknown): string | null {
  return typeof value === "string" && /^[a-z_]{1,80}$/.test(value)
    ? value
    : null;
}

/** Keep useful error metadata without exposing raw upstream messages or credentials. */
export async function readSessionError(
  response: Response,
): Promise<ErrorDetails> {
  const payload: unknown = await response.json().catch(() => null);
  const error =
    payload && typeof payload === "object" && "error" in payload
      ? payload.error
      : null;
  const details = error && typeof error === "object" ? error : {};
  const code = identifier("code" in details ? details.code : null);
  const type = identifier("type" in details ? details.type : null);
  const retry = response.headers.get("retry-after");
  const retryAfter = retry && /^\d{1,6}$/.test(retry) ? retry : null;
  let message: string;

  if (response.status === 429) {
    const quotaMessage = quotaMessages[code ?? ""] ?? quotaMessages[type ?? ""];
    if (quotaMessage) {
      message = quotaMessage;
    } else if (
      code === "rate_limit_exceeded" ||
      code === "slow_down" ||
      type === "rate_limit_exceeded" ||
      type === "rate_limit_error"
    ) {
      message = retryAfter
        ? `OpenAI's GPT-Live rate limit was reached. Wait ${retryAfter} seconds before reconnecting. If it persists, check the project's GPT-Live limits.`
        : "OpenAI's GPT-Live rate limit was reached. Wait briefly before reconnecting. If it persists, check the project's GPT-Live limits.";
    } else {
      message =
        "OpenAI rejected the session with HTTP 429. Check the API project's quota and GPT-Live rate limits; OpenAI did not identify which limit in a recognized error code.";
    }
  } else if (response.status === 401) {
    message =
      "OpenAI rejected the API key. Check OPENAI_API_KEY and restart the server.";
  } else if (response.status === 403) {
    message =
      "This OpenAI project does not have access to the selected GPT-Live model.";
  } else {
    message =
      "OpenAI could not start the voice session. Check the model and voice settings and try again.";
  }

  return {
    message: code ? `${message} (OpenAI: ${code})` : message,
    code,
    type,
    requestId: response.headers.get("x-request-id"),
    retryAfter,
  };
}
