import { BenchmarkOperationError } from "./correctness.mjs";
const classifications = new Set(["authentication", "authorization", "timeout", "transport/sdk", "invalid_response", "application", "backend_health"]);
const safeCode = /^[A-Za-z0-9_-]{1,40}$/;
const sessionStateCodes = new Set(["signed_out", "invalid_session", "session_missing"]);
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function safeErrorText(message, knownValues = [], maxLength = 300) {
    let safe = message.slice(0, Math.max(maxLength * 4, maxLength))
        .replace(/([?&](?:password|passwd|secret|token|api[_-]?key|access[_-]?key|authorization)=)[^&#\s]*/gi, "$1[REDACTED]")
        .replace(/(["']?authorization["']?)\s*[:=]\s*(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^,;}\r\n]*)/gi, "$1=[REDACTED]")
        .replace(/\b(Bearer|Basic)\s+[^\s,;}]+/gi, "$1 [REDACTED]")
        .replace(/(["']?)(password|passwd|secret|token|api[_-]?key|access[_-]?key)\1\s*[:=]\s*(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s,;&}]+)/gi, "$2=[REDACTED]")
        .replace(/\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]");
    const values = [...new Set(knownValues.filter(value => typeof value === "string" && value.length > 0 && value.length <= 1024))].sort((left, right) => right.length - left.length);
    for (const value of values) {
        const pattern = value.length < 4 ? new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(value)}(?=$|[^A-Za-z0-9_])`, "g") : new RegExp(escapeRegExp(value), "g");
        safe = safe.replace(pattern, value.length < 4 ? "$1[REDACTED]" : "[REDACTED]");
    }
    return safe.slice(0, maxLength);
}
export function safeErrorDetails(error, knownValues = []) {
    const rawMessage = error instanceof Error ? error.message : error === null ? "null" : typeof error === "object" ? "object" : String(error);
    const details = {
        name: safeErrorText(error instanceof Error ? error.name : typeof error, knownValues, 100),
        message: safeErrorText(rawMessage, knownValues),
    };
    if (!(error instanceof BenchmarkOperationError))
        return details;
    if (classifications.has(error.classification))
        details.classification = error.classification;
    const code = error.code && safeErrorText(error.code, knownValues, 40);
    if (code && safeCode.test(code))
        details.code = code;
    const status = error.status;
    if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599)
        details.status = status;
    return details;
}
export function isScoredMeasuredError(error) {
    return error instanceof BenchmarkOperationError && error.classification !== "invalid_response";
}
export function isSessionLossError(error, workflow) {
    return workflow === "signOutIn" || (error instanceof BenchmarkOperationError && (error.status === 401 || (error.code !== undefined && sessionStateCodes.has(error.code))));
}
export function isIntegrityError(error) {
    return !isScoredMeasuredError(error);
}
