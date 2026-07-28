import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";

import { clearConfigUrlImport, parseConfigUrlImport } from "@/lib/config-url-import";
import { scheduleStartupMediaSweep } from "@/services/startup-media-sweep";
import { createModelChannel, useConfigStore } from "@/stores/use-config-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    useEffect(() => {
        scheduleStartupMediaSweep();
    }, []);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const { baseUrl, apiKey } = parseConfigUrlImport(window.location.search, window.location.hash);
        if (!baseUrl && !apiKey) return;
        handledConfigParams.current = true;
        window.history.replaceState(null, "", clearConfigUrlImport(window.location));
        const firstChannel = config.channels[0];
        updateConfig(
            "channels",
            firstChannel
                ? config.channels.map((channel, index) =>
                      index === 0
                          ? {
                                ...channel,
                                ...(baseUrl ? { baseUrl } : {}),
                                ...(apiKey ? { apiKey } : {}),
                            }
                          : channel,
                  )
                : [createModelChannel({ id: "default", name: "默认渠道", baseUrl: baseUrl || undefined, apiKey: apiKey || "" })],
        );
        if (baseUrl) updateConfig("baseUrl", baseUrl);
        if (apiKey) updateConfig("apiKey", apiKey);
        openConfigDialog(false);
        message.success("已导入本地直连配置");
    }, [config.channels, message, openConfigDialog, updateConfig]);

    return <>{children}</>;
}
