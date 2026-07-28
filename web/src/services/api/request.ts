export type ApiParams = Record<string, string | string[] | number | number[] | undefined>;

export function compactApiParams(params: ApiParams) {
    return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== "" && value !== undefined && (!Array.isArray(value) || value.length > 0))) as ApiParams;
}

export function serializeApiParams(params?: ApiParams) {
    const queryParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params || {})) {
        if (value === undefined) continue;
        if (Array.isArray(value)) value.forEach((item) => queryParams.append(key, String(item)));
        else queryParams.set(key, String(value));
    }
    return queryParams;
}

export function isRelayRequestUrl(url: string) {
    try {
        return /(?:^|\/)relay\/https?:\/\//i.test(new URL(url, "http://localhost").pathname);
    } catch {
        return false;
    }
}

export function withRelayTokenHeader(url: string, relayToken: string, headers: Record<string, string>) {
    return isRelayRequestUrl(url) && relayToken ? { ...headers, "x-relay-token": relayToken } : headers;
}
