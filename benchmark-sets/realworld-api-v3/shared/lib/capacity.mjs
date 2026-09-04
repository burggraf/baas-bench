import { configuredWorkflowNames, operationClassForWorkflow } from "./workflows.mjs";
const classes = ["read", "write", "authSearch"];
const stageNumbers = ["requestedUsers", "achievedUsers", "elapsedSeconds", "workflowTransactionsPerSecond", "remoteOperationsPerSecond", "readOperationsPerSecond", "writeOperationsPerSecond"];
const metricNumbers = ["errorRate", "latencyP50Ms", "latencyP95Ms", "latencyP99Ms", "latencyMinMs", "latencyMaxMs"];
const freeze = (value) => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value))
            freeze(child);
    }
    return value;
};
const finiteNonnegative = (value, label) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
        throw new Error(`${label} must be finite and nonnegative`);
    return value;
};
const strictlyBelow = (value, threshold) => value < threshold && threshold - value > Number.EPSILON * Math.max(Number.MIN_VALUE, Math.abs(value), Math.abs(threshold)) * 4;
const record = (value, label) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`${label} must be an object`);
    return value;
};
const validateConfig = (config) => {
    const raw = record(config, "config");
    const weights = record(raw.weights, "config.weights");
    const expectedWorkflows = new Set(configuredWorkflowNames);
    if (Object.keys(weights).length !== expectedWorkflows.size || Object.keys(weights).some(name => !expectedWorkflows.has(name)))
        throw new Error("Invalid config workflow weights");
    let total = 0;
    for (const name of configuredWorkflowNames) {
        const weight = finiteNonnegative(weights[name], `weight ${name}`);
        total += weight;
    }
    if (!Number.isFinite(total) || total !== 100)
        throw new Error("Workflow weights must total 100");
    const slos = record(raw.slos, "config.slos");
    if (Object.keys(slos).length !== classes.length || Object.keys(slos).some(name => !classes.includes(name)))
        throw new Error("Invalid config SLO keys");
    const active = { read: 0, write: 0, authSearch: 0 };
    for (const name of configuredWorkflowNames)
        active[operationClassForWorkflow(name)] += finiteNonnegative(weights[name], `weight ${name}`);
    for (const name of classes) {
        const slo = record(slos[name], `SLO ${name}`);
        const p95Ms = finiteNonnegative(slo.p95Ms, `${name}.p95Ms`);
        const maxErrorRate = finiteNonnegative(slo.maxErrorRate, `${name}.maxErrorRate`);
        if (p95Ms <= 0 || maxErrorRate > 1)
            throw new Error(`Invalid ${name} SLO`);
    }
    return active;
};
const validateMetric = (value, label) => {
    const metric = record(value, label);
    for (const name of ["attempted", "completed", "failed"]) {
        const count = metric[name];
        if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0)
            throw new Error(`${label}.${name} must be a nonnegative safe integer`);
    }
    for (const name of metricNumbers)
        finiteNonnegative(metric[name], `${label}.${name}`);
    if (metric.completed + metric.failed !== metric.attempted)
        throw new Error(`${label} completed+failed must equal attempted`);
    if (metric.errorRate > 1 || metric.errorRate !== (metric.attempted ? metric.failed / metric.attempted : 0))
        throw new Error(`${label}.errorRate is inconsistent with attempted/failed`);
    if (!(metric.latencyMinMs <= metric.latencyP50Ms && metric.latencyP50Ms <= metric.latencyP95Ms && metric.latencyP95Ms <= metric.latencyP99Ms && metric.latencyP99Ms <= metric.latencyMaxMs))
        throw new Error(`${label} latency percentiles must be ordered`);
    return metric;
};
const validateStage = (stage, index) => {
    const raw = record(stage, `stage ${index}`);
    for (const name of stageNumbers)
        finiteNonnegative(raw[name], `stage ${index}.${name}`);
    const requestedUsers = raw.requestedUsers;
    const achievedUsers = raw.achievedUsers;
    if (typeof requestedUsers !== "number" || !Number.isSafeInteger(requestedUsers) || requestedUsers < 1)
        throw new Error(`stage ${index}.requestedUsers must be a positive safe integer`);
    if (typeof achievedUsers !== "number" || !Number.isSafeInteger(achievedUsers) || achievedUsers < 0 || achievedUsers > requestedUsers)
        throw new Error(`stage ${index}.achievedUsers must be a nonnegative count no greater than requestedUsers`);
    if (typeof raw.valid !== "boolean" || !Array.isArray(raw.validityReasons) || raw.validityReasons.some(reason => typeof reason !== "string"))
        throw new Error(`stage ${index} validity is malformed`);
    if ((raw.valid === true && raw.validityReasons.length > 0) || (raw.valid === false && raw.validityReasons.length === 0))
        throw new Error(`stage ${index} validity state is inconsistent`);
    const metricsRaw = record(raw.operationClassMetrics ?? {}, `stage ${index}.operationClassMetrics`);
    for (const name of Object.keys(metricsRaw))
        if (!classes.includes(name))
            throw new Error(`Unknown operation class ${name}`);
    return Object.fromEntries(Object.entries(metricsRaw).map(([name, metric]) => [name, validateMetric(metric, `stage ${index}.${name}`)]));
};
export function evaluateCapacity(stages, config, options = {}) {
    if (!Array.isArray(stages))
        throw new Error("stages must be an array");
    const activeWeights = validateConfig(config);
    const minAchievedRatio = options.minAchievedRatio ?? 0.95;
    const minSamples = options.minSamples ?? 20;
    const materialIncrease = options.materialIncrease ?? 0.2;
    const maxThroughputGain = options.maxThroughputGain ?? 0.1;
    if (!Number.isFinite(minAchievedRatio) || minAchievedRatio < 0 || minAchievedRatio > 1)
        throw new Error("minAchievedRatio must be between 0 and 1");
    if (!Number.isSafeInteger(minSamples) || minSamples < 1)
        throw new Error("minSamples must be a positive safe integer");
    if (!Number.isFinite(materialIncrease) || materialIncrease < 0)
        throw new Error("materialIncrease must be finite and nonnegative");
    if (!Number.isFinite(maxThroughputGain) || maxThroughputGain < 0)
        throw new Error("maxThroughputGain must be finite and nonnegative");
    const validated = stages.map((stage, index) => ({ stage, metrics: validateStage(stage, index) }));
    for (let i = 1; i < validated.length; i++)
        if (validated[i].stage.requestedUsers <= validated[i - 1].stage.requestedUsers)
            throw new Error("requestedUsers must be strictly increasing");
    const evaluations = validated.map(({ stage, metrics }, index) => {
        const reasons = stage.valid ? [] : [...stage.validityReasons];
        const invalid = !stage.valid;
        if (stage.achievedUsers / stage.requestedUsers < minAchievedRatio)
            reasons.push(`achieved/requested ${stage.achievedUsers}/${stage.requestedUsers} below ${minAchievedRatio}`);
        const operationClasses = Object.fromEntries(classes.map(name => {
            const metric = metrics[name];
            const classReasons = [];
            if (activeWeights[name] > 0 && !metric)
                classReasons.push(`${name} missing from stage operationClassMetrics`);
            if (metric && activeWeights[name] > 0) {
                if (metric.attempted < minSamples)
                    classReasons.push(`${name} has fewer than ${minSamples} attempted workflow samples (${metric.attempted})`);
                const slo = config.slos[name];
                if (metric.latencyP95Ms > slo.p95Ms)
                    classReasons.push(`${name} p95Ms ${metric.latencyP95Ms} exceeds ${slo.p95Ms}`);
                if (metric.errorRate >= slo.maxErrorRate)
                    classReasons.push(`${name} errorRate ${metric.errorRate} is at or above ${slo.maxErrorRate}`);
            }
            return [name, { ...(metric ?? { attempted: 0, completed: 0, failed: 0, errorRate: 0, latencyP50Ms: 0, latencyP95Ms: 0, latencyP99Ms: 0, latencyMinMs: 0, latencyMaxMs: 0 }), operationClass: name, passed: classReasons.length === 0, reasons: classReasons }];
        }));
        for (const name of classes)
            reasons.push(...operationClasses[name].reasons);
        return { requestedUsers: stage.requestedUsers, achievedUsers: stage.achievedUsers, passed: !invalid && reasons.length === 0, invalid, saturated: false, reasons, operationClasses };
    });
    let firstSaturation;
    for (let index = 1; index < validated.length; index++) {
        const previous = validated[index - 1].stage;
        const current = validated[index].stage;
        if (!evaluations[index - 1].passed || !evaluations[index].passed || current.requestedUsers < previous.requestedUsers + previous.requestedUsers * materialIncrease || previous.workflowTransactionsPerSecond <= 0)
            continue;
        const tpsGain = (current.workflowTransactionsPerSecond - previous.workflowTransactionsPerSecond) / previous.workflowTransactionsPerSecond;
        if (!Number.isFinite(tpsGain) || !strictlyBelow(tpsGain, maxThroughputGain))
            continue;
        const increasedLatencies = Object.fromEntries(classes.filter(name => activeWeights[name] > 0).flatMap(name => {
            const before = validated[index - 1].metrics[name].latencyP95Ms;
            const after = validated[index].metrics[name].latencyP95Ms;
            return after > before ? [[name, { previousP95Ms: before, currentP95Ms: after }]] : [];
        }));
        if (Object.keys(increasedLatencies).length === 0)
            continue;
        const evidence = { previousUsers: previous.requestedUsers, currentUsers: current.requestedUsers, previousTps: previous.workflowTransactionsPerSecond, currentTps: current.workflowTransactionsPerSecond, tpsGain, increasedLatencies };
        evaluations[index].saturated = true;
        evaluations[index].reasons.push(`saturation: users ${previous.requestedUsers}->${current.requestedUsers}, TPS gain ${tpsGain}, rising p95 ${JSON.stringify(increasedLatencies)}`);
        firstSaturation ??= { index, evidence };
    }
    let lastContiguousPass = -1;
    while (lastContiguousPass + 1 < evaluations.length && evaluations[lastContiguousPass + 1].passed)
        lastContiguousPass++;
    const selectedIndex = Math.min(lastContiguousPass, firstSaturation ? firstSaturation.index - 1 : Number.MAX_SAFE_INTEGER);
    const users = selectedIndex >= 0 ? evaluations[selectedIndex].requestedUsers : 0;
    const reasons = evaluations.flatMap(stage => stage.reasons);
    if (users === 0)
        reasons.push("No contiguous SLO-passing capacity stage");
    const result = { users, capacityUsers: users, selectedCapacityUsers: users, hasCapacity: users > 0, saturation: Boolean(firstSaturation), reasons, stages: evaluations, saturationEvidence: firstSaturation?.evidence ?? null };
    return freeze(result);
}


const INITIAL_STAGES = [5, 10, 25, 50];
export function nextCapacityStage({ measuredUsers, lowerPass, upperFailure, refinements = 0, maxUsers = 10_000 }) {
    if (!Array.isArray(measuredUsers) || measuredUsers.some(value => !Number.isSafeInteger(value) || value < 1))
        throw new RangeError("measuredUsers must contain positive integers");
    const measured = new Set(measuredUsers);
    for (const stage of INITIAL_STAGES) if (!measured.has(stage)) return stage;
    if (upperFailure !== undefined) {
        if (!Number.isSafeInteger(lowerPass) || !Number.isSafeInteger(upperFailure) || lowerPass < 1 || upperFailure <= lowerPass)
            throw new RangeError("invalid capacity bracket");
        if (refinements >= 4 || upperFailure - lowerPass <= 1) return null;
        const midpoint = Math.floor((lowerPass + upperFailure) / 2);
        return measured.has(midpoint) ? null : midpoint;
    }
    const highest = Math.max(...measuredUsers);
    if (highest >= maxUsers) return null;
    return Math.min(maxUsers, highest * 2);
}
