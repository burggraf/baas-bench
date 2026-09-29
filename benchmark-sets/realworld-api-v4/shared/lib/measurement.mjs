import { AsyncLocalStorage } from "node:async_hooks";
import { safeErrorDetails } from "./errors.mjs";
const contexts = new AsyncLocalStorage();
export async function withRemoteMeasurement(context, work) {
    const stored = { ...context, active: true };
    return contexts.run(stored, async () => {
        try {
            return await work();
        }
        finally {
            stored.active = false;
        }
    });
}
export async function measureRemoteCall(work) {
    const context = contexts.getStore();
    if (!context?.active)
        return work();
    const started = context.now();
    let result;
    try {
        result = await work();
    }
    catch (error) {
        context.sample({ type: "remote", name: context.name, workflow: context.workflow, operationClass: context.operationClass, kind: context.kind, elapsedMs: Math.max(0, context.now() - started), success: false, error: safeErrorDetails(error, context.redactValues) });
        throw error;
    }
    context.sample({ type: "remote", name: context.name, workflow: context.workflow, operationClass: context.operationClass, kind: context.kind, elapsedMs: Math.max(0, context.now() - started), success: true });
    return result;
}
