/** Normalize any thrown/rejected value into a reportable Error. */
export function toReportableError(value) {
    if (value instanceof Error)
        return value;
    if (value === null)
        return new Error("null");
    if (value === undefined)
        return new Error("undefined");
    if (typeof value === "string")
        return new Error(value);
    if (typeof value === "number" ||
        typeof value === "boolean" ||
        typeof value === "bigint") {
        return new Error(String(value));
    }
    if (typeof value === "symbol")
        return new Error(value.toString());
    if (typeof value === "object") {
        try {
            const json = JSON.stringify(value);
            if (typeof json === "string")
                return new Error(json);
        }
        catch {
            // circular / non-serializable
        }
        return new Error(Object.prototype.toString.call(value));
    }
    return new Error(String(value));
}
