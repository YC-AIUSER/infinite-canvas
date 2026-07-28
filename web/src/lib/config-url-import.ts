export type ConfigUrlImport = {
    baseUrl: string;
    apiKey: string;
};

const CONFIG_PARAM_NAMES = ["baseUrl", "baseurl", "apiKey", "apikey"];

export function parseConfigUrlImport(search: string, hash: string): ConfigUrlImport {
    const searchParams = new URLSearchParams(search);
    const hashParams = new URLSearchParams(hash.replace(/^#/, ""));
    return {
        baseUrl: readParam(hashParams, "baseUrl", "baseurl") || readParam(searchParams, "baseUrl", "baseurl"),
        apiKey: readParam(hashParams, "apiKey", "apikey") || readParam(searchParams, "apiKey", "apikey"),
    };
}

export function clearConfigUrlImport(location: Pick<Location, "pathname" | "search" | "hash">) {
    const searchParams = new URLSearchParams(location.search);
    const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
    CONFIG_PARAM_NAMES.forEach((name) => {
        searchParams.delete(name);
        hashParams.delete(name);
    });
    const search = searchParams.toString();
    const hash = hashParams.toString();
    return `${location.pathname}${search ? `?${search}` : ""}${hash ? `#${hash}` : ""}`;
}

function readParam(params: URLSearchParams, primary: string, fallback: string) {
    return params.get(primary) || params.get(fallback) || "";
}
